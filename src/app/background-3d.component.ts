import { Component, ElementRef, OnInit, OnDestroy, ViewChild, ChangeDetectionStrategy, NgZone, PLATFORM_ID, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { getProject, type ISheetObject } from '@theatre/core';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PhysicsManager } from './physics-manager';
import { PostProcessManager } from './post-process-manager';
import { THEATRE_CAMERA_PROJECT_STATE, THEATRE_SLIDE_SEQUENCE_POSITIONS, THEATRE_TOUR_SEQUENCE_POSITIONS } from './theatre-camera.state';

interface TheatreCameraRig {
  offset: { x: number; y: number; z: number };
  lookOffset: { x: number; y: number; z: number };
  drift: { x: number; y: number; z: number };
  mouseParallax: { x: number; y: number; z: number };
  lerp: number;
  flareVisible: boolean;
}

interface CameraBreathing {
  x: number;
  y: number;
  z: number;
}

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
  @Output() telemetry = new EventEmitter<{altitude: number, speed: number, phase: string} | null>();
  @Output() loadProgress = new EventEmitter<number>();
  @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef<HTMLDivElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private readonly physicsManager = new PhysicsManager();
  private postProcessManager: PostProcessManager | null = null;
  private jupiterGroup!: THREE.Group;
  private jupiter!: THREE.Mesh;
  private atmosphere!: THREE.Mesh;
  
  // 95 Moons: 4 Galilean + 91 small moons
  private readonly galileanMoons: { mesh: THREE.Mesh, distance: number, speed: number, angle: number }[] = [];
  private smallMoons!: THREE.InstancedMesh;
  private readonly smallMoonTimeUniform = { value: 0 };
  private readonly smallMoonsData: { distance: number, speed: number, angle: number, inclination: number }[] = [];
  
  private stars!: THREE.Points;
  private starClusters!: THREE.InstancedMesh;
  private dustSystem!: THREE.Points;
  private animationFrameId: number | null = null;
  private lastRenderTime = 0;
  private readonly isBrowser: boolean;
  private readonly startTime = Date.now();
  private prefersReducedMotion = false;
  private tabHidden = false;
  private readonly floatingOriginThreshold = 10_000;
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly tempSphere = new THREE.Sphere();
  private readonly cameraBreathing = new THREE.Vector3();
  private readonly moonLocalCameraOffset = new THREE.Vector3();
  private readonly moonLocalLookOffset = new THREE.Vector3();
  private readonly moonWorldCameraPosition = new THREE.Vector3();
  private readonly moonWorldLookPosition = new THREE.Vector3();
  private readonly frustumCullTargets: Array<{ object: THREE.Object3D; radius: number }> = [];
  private readonly resizeHandler = () => this.onWindowResize();
  private readonly mouseMoveHandler = (event: MouseEvent) => this.onMouseMove(event);
  private readonly visibilityHandler = () => this.onVisibilityChange();
  
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
  private theatreCameraObject: ISheetObject | null = null;
  private theatreCameraValues: TheatreCameraRig = {
    offset: { x: -7, y: 8, z: 52 },
    lookOffset: { x: 0, y: 1, z: 0 },
    drift: { x: 0, y: -0.002, z: -0.008 },
    mouseParallax: { x: 3, y: 3, z: 0 },
    lerp: 0.015,
    flareVisible: true,
  };
  private theatreCameraUnsubscribe: (() => void) | null = null;
  private theatreCurrentSequencePosition = 0;

  private earthMesh!: THREE.Mesh;

  private readonly nebulae: THREE.Mesh[] = [];

  // Spaceships orbiting Jupiter
  private readonly spaceshipData: {
    group: THREE.Group;
    orbitRadius: number;
    orbitSpeed: number;
    orbitAngle: number;
    orbitY: number;
    orbitInclination: number;
    trail: THREE.Line | null;
    trailLength: number;
  }[] = [];
  private targetShipSpeedMultiplier = 1;
  private currentShipSpeedMultiplier = 1;
  private readonly loadPromises: Promise<unknown>[] = [];

  // Earth orbit for h3 distance visualization
  private earthOrbitAngle = 0;
  private earthOrbitActive = false;

  // Earth's Moon (Luna) orbiting Earth
  private moonMesh!: THREE.Mesh;
  private moonOrbitAngle = 0;
  private tranquilityGroup!: THREE.Group; // Apollo 11 landing site artifacts
  private lunarDust!: THREE.Points;
  private lunarDustVelocities!: Float32Array;
  private lunarDustLife!: Float32Array;
  private lunarDustActive = false;
  private lunarDustTimer = 0;
  private earthshineLight!: THREE.DirectionalLight;

  // Titan — Saturn's largest moon
  private titanMesh!: THREE.Mesh;
  private titanOrbitAngle = 0;

  // Pluto — dwarf planet beyond Neptune
  private plutoMesh!: THREE.Mesh;

  // Starman — Tesla Roadster drifting in heliocentric orbit (easter egg)
  private starmanGroup!: THREE.Group;
  private starmanOrbitAngle = 0.5; // Start in front of Earth relative to default camera

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
  private sunFlare!: THREE.Mesh;
  private sunLight!: THREE.DirectionalLight;
  private readonly sunPosition = new THREE.Vector3(-100, 20, 65);

  // Jupiter night-side lightning
  private readonly lightningFlashes: { mesh: THREE.Mesh, timer: number, cooldown: number }[] = [];

  // Io plasma torus (ionized sulfur ring along Io's orbit)
  private ioPlasmaTorusMesh!: THREE.Mesh;

  // Europa water plumes
  private europaPlume!: THREE.Points;

  // Solar wind particles streaming from sun
  private solarWind!: THREE.Points;

  // Jupiter radiation belts
  private radiationBelt!: THREE.Mesh;

  // Trojan asteroid clusters at L4/L5
  private trojanL4!: THREE.InstancedMesh;
  private trojanL5!: THREE.InstancedMesh;

  // Zodiacal light
  private zodiacalLight!: THREE.Mesh;

  // Death Star
  private deathStarGroup!: THREE.Group;
  private superlaserBeam!: THREE.Mesh;
  private superlaserFiring = false;
  private superlaserTimer = 0;

  // Death Star → Pluto destruction sequence
  private plutoDestroyed = false;
  private deathStarPlutoAttackStarted = false;
  private deathStarPlutoFlyTime = 0;
  private plutoExplosionTime = -1;
  private plutoShockwave!: THREE.Mesh;
  private plutoDebris!: THREE.InstancedMesh;
  private plutoDebrisVelocities!: Float32Array;
  private plutoFlashLight!: THREE.PointLight;

  // JULIANASCHOOL star constellation after Pluto destruction
  private julianaStars!: THREE.Points;

  // ASBJØRN meteorite constellation (background easter egg)
  private asbjornMeteorRocks!: THREE.InstancedMesh;
  private asbjornMeteorGlow!: THREE.Points;
  private asbjornMeteorCount = 0;
  private asbjornStormGroup!: THREE.Group;

  // Subtle cross constellation (tribute)
  private crossConstellation!: THREE.Points;

  // Floating astronaut near Tesla Roadster
  private astronautGroup!: THREE.Group;

  // Columbia memorial sequence
  private columbiaGroup!: THREE.Group;
  private columbiaShuttleMesh!: THREE.Group;
  private columbiaDebris!: THREE.InstancedMesh;
  private columbiaDebrisVelocities!: Float32Array;
  private columbiaTrails!: THREE.Points;
  private columbiaFlashLight!: THREE.PointLight;
  private columbiaMemorialStars!: THREE.Points;
  private columbiaSequenceActive = false;
  private columbiaSequenceTime = 0;
  private columbiaBreakupDone = false;

  // Fallen astronaut memorial
  private fallenAstronautGroup!: THREE.Group;

  // Gargantua Black Hole
  private blackHoleGroup!: THREE.Group;
  private accretionDisk!: THREE.Mesh;

  // Lightsaber duel
  private lightsaberGroup!: THREE.Group;
  private saberRed!: THREE.Mesh;
  private saberGreen!: THREE.Mesh;
  private saberGlowRed!: THREE.Mesh;
  private saberGlowGreen!: THREE.Mesh;
  private saberLightRed!: THREE.PointLight;
  private saberLightGreen!: THREE.PointLight;
  private saberDuelTimer = 0;
  private readonly saberClashSparks!: THREE.Points;
  private readonly saberSparkPositions = new Float32Array(60 * 3); // 60 sparks
  private readonly saberSparkVelocities = new Float32Array(60 * 3);
  private readonly saberSparkLifetimes = new Float32Array(60);
  private saberSparkIndex = 0;
  // Duel combatant pivots
  private sithPivot!: THREE.Group;
  private jediPivot!: THREE.Group;
  // Duel choreography — sequence of { duration, sithAngle, jediAngle, clash }
  private readonly duelMoves = [
    { dur: 0.5, sithZ: 0.8, jediZ: -0.5, sithX: 0.15, jediX: -0.15, clash: false },
    { dur: 0.35, sithZ: -0.2, jediZ: 0.4, sithX: -0.1, jediX: 0.1, clash: true },
    { dur: 0.6, sithZ: 1.1, jediZ: -0.9, sithX: 0.2, jediX: -0.3, clash: false },
    { dur: 0.25, sithZ: 0.1, jediZ: 0.1, sithX: 0, jediX: 0, clash: true },
    { dur: 0.7, sithZ: -0.6, jediZ: 1.2, sithX: -0.2, jediX: 0.25, clash: false },
    { dur: 0.3, sithZ: 0.3, jediZ: -0.3, sithX: 0.05, jediX: -0.05, clash: true },
    { dur: 0.55, sithZ: -1, jediZ: 0.7, sithX: 0.3, jediX: -0.15, clash: false },
    { dur: 0.4, sithZ: 0, jediZ: 0, sithX: -0.05, jediX: 0.05, clash: true },
  ];
  private duelMoveIndex = 0;
  private duelMoveElapsed = 0;

  // Hyperspace jump
  private hyperspaceActive = false;
  private hyperspaceTimer = 0;
  private readonly hyperspaceDuration = 2.5;
  private originalFov = 60;
  private readonly originalBloomIntensity = 1.6;

  // SpaceX Falcon 9 rocket launch
  private falconGroup!: THREE.Group;
  private falconFirstStage!: THREE.Group;
  private falconSecondStage!: THREE.Group;
  private falconFairingL!: THREE.Mesh;
  private falconFairingR!: THREE.Mesh;
  private falconExhaust!: THREE.Mesh;
  private falconSecondExhaust!: THREE.Mesh;
  private falconLegs: THREE.Group[] = [];
  private falconLaunched = false;
  private falconLaunchTime = 0;
  private falconHyperspaceTriggered = false;
  private falconSeparated = false;
  private falconFairingsJettisoned = false;
  private readonly falconFlightDuration = 18;
  private readonly falconStartPos = new THREE.Vector3();
  private readonly falconTargetPos = new THREE.Vector3();
  private readonly falconCameraAnchor = new THREE.Vector3();

  // Planet tour state
  private tourActive = false;
  private tourStopIndex = 0;
  private tourStopTime = 0;
  private tourTransitionProgress = 0;
  private readonly TOUR_STOP_DURATION = 8; // seconds at each planet
  private readonly TOUR_TRANSITION_DURATION = 3; // seconds flying between planets
  private tourStops: { name: keyof typeof THEATRE_TOUR_SEQUENCE_POSITIONS }[] = [];
  private activeCameraAnchorKey = 'title';

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
        this.activeCameraAnchorKey = 'jupiter';
        this.updateCameraForSlide(this.slideId);
      }
    }
  }

  private startPlanetTour() {
    this.tourStops = [];
    this.tourStops.push({ name: 'jupiter' });
    if (this.sunMesh) {
      this.tourStops.push({ name: 'zon' });
    }
    if (this.mercuryMesh) {
      this.tourStops.push({ name: 'mercurius' });
    }
    if (this.venusMesh) {
      this.tourStops.push({ name: 'venus' });
    }
    if (this.earthMesh) {
      this.earthMesh.visible = true;
      this.earthMesh.position.set(-8, 2, -5);
      this.tourStops.push({ name: 'aarde' });
    }
    if (this.marsMesh) {
      this.tourStops.push({ name: 'mars' });
    }
    if (this.moonMesh) {
      this.tourStops.push({ name: 'maan' });
    }
    if (this.starmanGroup) {
      this.tourStops.push({ name: 'starman' });
    }
    if (this.saturnGroup) {
      this.tourStops.push({ name: 'saturnus' });
    }
    if (this.uranusGroup) {
      this.tourStops.push({ name: 'uranus' });
    }
    if (this.neptuneGroup) {
      this.tourStops.push({ name: 'neptunus' });
    }
    if (this.plutoMesh) {
      this.tourStops.push({ name: 'pluto' });
    }
    if (this.blackHoleGroup) {
      this.tourStops.push({ name: 'blackhole' });
    }
    if (this.columbiaGroup) {
      this.tourStops.push({ name: 'columbia' });
    }
    this.tourStops.push({ name: 'jupiter-einde' });

    // Keep Earth fixed in tour mode so Columbia + Earth framing stays stable.
    this.earthOrbitActive = false;

    this.tourActive = true;
    this.tourStopIndex = 0;
    this.tourStopTime = (Date.now() - this.startTime) * 0.001;
    this.tourTransitionProgress = 0;
    this.userInteracting = false;
    this.activeCameraAnchorKey = this.tourStops[0].name;
    this.transitionTheatreCameraToKey(this.tourStops[0].name);
    this.tourPlanet.emit(this.tourStops[0].name);
  }

  private updatePlanetTour(time: number) {
    if (!this.tourActive || this.tourStops.length === 0) return;

    // Freeze tour progression while Falcon is in flight so the landing stays on-screen
    if (this.falconLaunched) {
      this.tourStopTime = time - this.TOUR_STOP_DURATION; // Hold the clock
      return;
    }

    const elapsed = time - this.tourStopTime;
    const totalStopTime = this.TOUR_STOP_DURATION + this.TOUR_TRANSITION_DURATION;

    if (elapsed >= totalStopTime) {
      this.advancePlanetTour(time);
      return;
    }

    this.activeCameraAnchorKey = this.tourStops[this.tourStopIndex].name;
  }

  private advancePlanetTour(time: number) {
    this.tourStopIndex = (this.tourStopIndex + 1) % this.tourStops.length;
    this.cameraDriftX = 0;
    this.cameraDriftY = 0;
    this.cameraDriftZ = 0;
    this.tourStopTime = time;
    this.activateCurrentTourStop(time);
  }

  private activateCurrentTourStop(time: number) {
    const stopName = this.tourStops[this.tourStopIndex].name;
    this.activeCameraAnchorKey = stopName;
    this.transitionTheatreCameraToKey(stopName);
    this.tourPlanet.emit(stopName);

    if (stopName === 'aarde' && !this.falconLaunched) {
      setTimeout(() => this.launchFalcon9(), 1500);
    }

    if (stopName === 'pluto' && !this.deathStarPlutoAttackStarted && !this.plutoDestroyed) {
      this.deathStarPlutoAttackStarted = true;
      this.deathStarPlutoFlyTime = time;
    }

    if (stopName === 'maan' && this.lunarDust && !this.lunarDustActive) {
      this.activateLunarDust();
    }

    // Columbia memorial — activate cinematic sequence
    if (stopName === 'columbia' && this.columbiaGroup) {
      this.columbiaGroup.visible = true;
      this.columbiaSequenceActive = true;
      this.columbiaSequenceTime = 0;
      this.columbiaBreakupDone = false;
      if (this.columbiaShuttleMesh) {
        this.columbiaShuttleMesh.visible = true;
        this.columbiaShuttleMesh.position.set(0, 0, 0);
        this.columbiaShuttleMesh.rotation.set(0, 0, 0);
      }
      if (this.columbiaDebris) {
        this.columbiaDebris.visible = false;
        this.columbiaDebris.position.set(0, 0, 0);
      }
      if (this.columbiaTrails) {
        this.columbiaTrails.position.set(-2, 0, 0);
      }
      if (this.columbiaFlashLight) this.columbiaFlashLight.intensity = 0;
      if (this.earthMesh) {
        this.earthMesh.visible = true;
        this.earthMesh.position.set(-8, 2, -5);
      }
      if (this.fallenAstronautGroup) this.fallenAstronautGroup.visible = true;
    }
  }

  private activateLunarDust() {
    this.lunarDustActive = true;
    this.lunarDustTimer = 0;
    const positions = this.lunarDust.geometry.attributes['position'] as THREE.BufferAttribute;
    for (let index = 0; index < this.lunarDustLife.length; index++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.012;
      positions.setXYZ(index, Math.cos(angle) * radius, 0.001, Math.sin(angle) * radius);
      this.lunarDustVelocities[index * 3] = (Math.random() - 0.5) * 0.00015;
      this.lunarDustVelocities[index * 3 + 1] = Math.random() * 0.0003 + 0.0001;
      this.lunarDustVelocities[index * 3 + 2] = (Math.random() - 0.5) * 0.00015;
      this.lunarDustLife[index] = 1.5 + Math.random() * 2.5;
    }
    positions.needsUpdate = true;
  }

  private updateCameraForSlide(id: string) {
    this.activeCameraAnchorKey = 'jupiter';
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
        this.targetShipSpeedMultiplier = 0.3;
        this.targetJupiterSpinSpeed = 0.0003;
        break;

      case 'inhoud':
        this.targetShipSpeedMultiplier = 1;
        break;

      case 'h1':
        this.targetAtmospherePulse = 1;
        this.targetJupiterSpinSpeed = 0.001; // Slightly faster — showing the gas swirling
        break;

      case 'h2':
        this.targetJupiterRotationY = 4.7;
        break;

      case 'h3':
        this.targetStarSpeed = 0.002;
        this.targetShipSpeedMultiplier = 2.5;
        if (this.earthMesh) this.earthMesh.visible = true;
        this.earthOrbitActive = true;
        this.distanceBeamActive = true;
        break;

      case 'h4':
        this.targetJupiterSpinSpeed = 0.0003; // Slow, ancient, timeless
        this.targetStarSpeed = 0.00005; // Stars barely move — frozen in time
        this.targetShipSpeedMultiplier = 0.3;
        break;

      case 'h5':
        this.targetMoonSpeedMultiplier = 30;
        this.targetJupiterSpinSpeed = 0.003; // Faster spin — showing rapid rotation
        if (this.earthMesh) {
          this.earthMesh.visible = true;
          this.earthMesh.position.set(-8, 2, -5);
        }
        break;

      case 'extra':
        this.targetMoonSpeedMultiplier = 3; // Visible but graceful orbital motion
        this.targetJupiterSpinSpeed = 0.001;
        break;

      case 'quiz':
        this.targetJupiterSpinSpeed = 0.012;
        this.targetStarSpeed = 0.004;
        this.targetShipSpeedMultiplier = 3;
        this.targetMoonSpeedMultiplier = 4;
        break;

      case 'afsluiting':
        this.targetShipSpeedMultiplier = 0.5;
        this.targetJupiterSpinSpeed = 0.0003;
        this.targetStarSpeed = 0.00005;
        break;

      default:
        break;
    }

    this.transitionTheatreCameraToKey(id);
  }

  ngOnInit() {
    if (this.isBrowser) {
      void this.initThreeJs().then(() => {
        void Promise.all(this.loadPromises).then(() => this.loaded.emit());
        this.ngZone.runOutsideAngular(() => {
          this.animate();
        });
      });
      globalThis.addEventListener('resize', this.resizeHandler);
      globalThis.addEventListener('mousemove', this.mouseMoveHandler);
      document.addEventListener('visibilitychange', this.visibilityHandler);
      this.prefersReducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    }
  }

  ngOnDestroy() {
    if (this.isBrowser) {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
      }
      globalThis.removeEventListener('resize', this.resizeHandler);
      globalThis.removeEventListener('mousemove', this.mouseMoveHandler);
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      if (this.renderer) {
        this.renderer.dispose();
      }
      this.theatreCameraUnsubscribe?.();
      this.postProcessManager?.dispose();
      this.physicsManager.dispose();
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

  private onVisibilityChange() {
    if (document.hidden) {
      this.tabHidden = true;
    } else {
      // Reset time tracking so we don't get a massive delta spike
      this.lastRenderTime = (Date.now() - this.startTime) * 0.001;
      this.tabHidden = false;
    }
  }

  /** Generates a procedural Jupiter placeholder texture (low-res — real 8K texture replaces it) */
  private generateJupiterTexture(): THREE.CanvasTexture {
    const W = 512, H = 256;
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
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
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

  private async initThreeJs() {
    await this.physicsManager.initialize();

    const container = this.canvasContainer.nativeElement;
    
    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.00015);

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.z = this.targetCameraZ;
    this.camera.position.x = this.targetCameraX;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Orbit controls — Google Earth-style zoom/pan/rotate
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.0;
    this.controls.panSpeed = 0.8;
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
    const skyGeo = new THREE.SphereGeometry(500, 48, 48);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0x111122,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      toneMapped: false
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.matrixAutoUpdate = false; // CRITICAL FOR CPU: Skips matrix math every frame
    skyMesh.updateMatrix();
    this.scene.add(skyMesh);
    // Shared loading manager for progress tracking
    const loadingManager = new THREE.LoadingManager();

    // Prevent the browser from choking trying to create mipmaps for large textures on CPU
    THREE.Texture.prototype.generateMipmaps = false;
    THREE.Texture.prototype.minFilter = THREE.LinearFilter;

    loadingManager.onProgress = (_url, itemsLoaded, itemsTotal) => {
      const pct = (itemsLoaded / itemsTotal) * 100;
      this.ngZone.run(() => this.loadProgress.emit(pct));
      if ((globalThis as Record<string, unknown>)['__loadPct__'] !== undefined) {
        (globalThis as Record<string, unknown>)['__loadPct__'] = pct;
      }
    };
    loadingManager.onError = (url) => {
      console.warn('Failed to load:', url);
    };
    // Load milky way texture onto skybox
    this.textureLoader = new THREE.TextureLoader(loadingManager);
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('8k_stars_milky_way.webp', (tex) => {
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        skyMat.map = tex;
        skyMat.color.setHex(0x333333); // neutral grey — let the texture do the talking
        skyMat.needsUpdate = true;

        // CRITICAL FOR CPU: PMREM Generator deleted.
        // We do not need heavy environment reflections in pitch-black space.

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

    // Stars — realistic magnitude distribution with spectral-class colors
    // Bright stars are rare but have visible halos+spikes; faint stars are crisp pinpoints
    const starsGeometry = new THREE.BufferGeometry();
    const starsVertices: number[] = [];
    const starsColors: number[] = [];
    const starsSizes: number[] = [];
    // Spectral-class colors (Hertzsprung-Russell): hot blue → cold red
    const starColorPalette = [
      [0.62, 0.72, 1],     // O/B — hot blue-white (rare, very bright)
      [0.8, 0.87, 1],      // A — blue-white (Sirius, Vega)
      [1, 0.97, 0.94],     // F — warm white
      [1, 0.93, 0.78],     // G — yellow-white (Sun-like)
      [1, 0.8, 0.6],       // K — orange
      [1, 0.68, 0.45],     // M — red-orange (faintest)
    ];
    const starWeights = [0.02, 0.06, 0.12, 0.2, 0.32, 0.28];
    const pickStarColor = () => {
      let r = Math.random();
      for (let i = 0; i < starWeights.length; i++) {
        r -= starWeights[i];
        if (r <= 0) return starColorPalette[i];
      }
      return starColorPalette[4];
    };

    // Reduced from 150,000 for CPU performance
    const STAR_COUNT = 15000;
    for (let i = 0; i < STAR_COUNT; i++) {
      // Spherical distribution
      const r = 80 + Math.pow(Math.random(), 0.5) * 1920;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starsVertices.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      const color = pickStarColor();
      starsColors.push(color[0], color[1], color[2]);
      // Realistic magnitude distribution: power-law with extended bright tail
      const mag = Math.random();
      let sz: number;
      if (mag < 0.65) sz = 0.2 + Math.random() * 0.6;        // Faint pinpoints
      else if (mag < 0.88) sz = 0.8 + Math.random() * 1.8;   // Moderate
      else if (mag < 0.96) sz = 2.5 + Math.random() * 3.5;   // Bright — halo visible
      else if (mag < 0.993) sz = 6 + Math.random() * 5;      // Very bright — full spikes
      else sz = 11 + Math.random() * 7;                      // Hero stars — dramatic spikes
      starsSizes.push(sz);
    }

    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
    starsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starsColors, 3));
    starsGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(starsSizes, 1));

    // Pre-bake star PSF with diffraction spikes into a 64x64 texture (avoids per-pixel trig in shader)
    const starPsfCanvas = document.createElement('canvas');
    const PSF_SIZE = 64;
    starPsfCanvas.width = PSF_SIZE; starPsfCanvas.height = PSF_SIZE;
    const psfCtx = starPsfCanvas.getContext('2d')!;
    const psfData = psfCtx.createImageData(PSF_SIZE, PSF_SIZE);
    for (let py = 0; py < PSF_SIZE; py++) {
      for (let px = 0; px < PSF_SIZE; px++) {
        const ux = (px / PSF_SIZE) - 0.5;
        const uy = (py / PSF_SIZE) - 0.5;
        const dist = Math.hypot(ux, uy);
        // Core (Airy)
        const core = Math.exp(-dist * dist * 450);
        // Airy ring
        const ringDist = Math.abs(dist - 0.12);
        const airyRing = Math.exp(-ringDist * ringDist * 2000) * 0.15;
        // Halo
        const halo = Math.exp(-dist * 10) * 0.3;
        // Outer glow
        const outerGlow = Math.exp(-dist * 4.5) * 0.1;
        // 6-point spikes at 60° intervals
        let spike = 0;
        const radial = Math.exp(-dist * 4);
        for (let si = 0; si < 3; si++) {
          const angle = si * 1.0471975;
          const cs = Math.cos(angle);
          const sn = Math.sin(angle);
          const perp = Math.abs(-ux * sn + uy * cs);
          const along = Math.abs(ux * cs + uy * sn);
          spike += Math.exp(-perp * 55) * Math.exp(-along * 3.5);
        }
        spike *= radial * 0.45;
        // R = core+halo+glow (PSF), G = airyRing, B = spike, A = total luminance
        const luminance = Math.min(core + airyRing + halo + outerGlow + spike, 1);
        const idx = (py * PSF_SIZE + px) * 4;
        psfData.data[idx    ] = Math.min(255, (core + halo + outerGlow) * 255);
        psfData.data[idx + 1] = Math.min(255, airyRing * 255);
        psfData.data[idx + 2] = Math.min(255, spike * 255);
        psfData.data[idx + 3] = Math.min(255, luminance * 255);
      }
    }
    psfCtx.putImageData(psfData, 0, 0);
    const starPsfTexture = new THREE.CanvasTexture(starPsfCanvas);
    starPsfTexture.generateMipmaps = false;
    starPsfTexture.minFilter = THREE.LinearFilter;
    starPsfTexture.magFilter = THREE.LinearFilter;

    const starsMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPsfMap: { value: starPsfTexture },
      },
      vertexShader: `
        attribute float aSize;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vSize;
        varying float vTwinkle;
        uniform float uTime;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          // Multi-frequency scintillation — 3 incommensurate sine waves
          float phase = color.r * 127.1 + color.g * 311.7 + position.x * 0.013;
          float t1 = sin(uTime * 1.1 + phase) * 0.12;
          float t2 = sin(uTime * 2.7 + phase * 1.37) * 0.08;
          float t3 = sin(uTime * 0.4 + phase * 0.71) * 0.06;
          float twinkle = 0.74 + t1 + t2 + t3;
          vTwinkle = twinkle;
          float sz = aSize * twinkle * (300.0 / -mvPosition.z);
          vSize = sz;
          gl_PointSize = min(sz, 96.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uPsfMap;
        varying vec3 vColor;
        varying float vSize;
        varying float vTwinkle;
        void main() {
          vec2 uv = gl_PointCoord;
          float dist = length(uv - vec2(0.5));
          if (dist > 0.5) discard;

          // Sample pre-baked PSF texture: R=core+halo, G=airyRing, B=spikes, A=total
          vec4 psf = texture2D(uPsfMap, uv);
          float core = psf.r;
          float airyRing = psf.g;
          float spike = psf.b;
          float luminance = psf.a;

          // Scale features by star size
          float haloStrength = smoothstep(1.5, 6.0, vSize);
          float spikeStrength = smoothstep(2.0, 12.0, vSize);
          float ringStrength = smoothstep(2.0, 6.0, vSize);

          float scaledLum = core + airyRing * ringStrength + (luminance - core - airyRing) * haloStrength + spike * spikeStrength;

          // Chromatic fringing on spike tips (bright stars only)
          vec3 fringeColor = vColor;
          if (vSize > 5.0) {
            float fringeStr = smoothstep(5.0, 14.0, vSize) * 0.25;
            float redShift = spike * spikeStrength * (1.0 - core) * fringeStr;
            fringeColor = vColor + vec3(redShift * 0.4, -redShift * 0.1, redShift * 0.3);
          }

          // White-hot core → spectral color gradient
          vec3 finalColor = mix(fringeColor, vec3(1.0, 1.0, 0.98), core * 0.8 + airyRing * 0.3);
          finalColor += spike * spikeStrength * vec3(0.9, 0.85, 1.0) * 0.3;

          // Sharpen faint stars so they don't look milky/blurry
          float alpha = clamp(scaledLum, 0.0, 1.0) * mix(0.3, 1.0, clamp(vSize / 5.0, 0.0, 1.0));
          gl_FragColor = vec4(finalColor * (0.85 + vTwinkle * 0.2), alpha);
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
    this.dustSystem.frustumCulled = false;
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
    
    const jupiterGeometry = new THREE.SphereGeometry(10, 128, 128);
    const jupiterMaterial = new THREE.MeshStandardMaterial({ 
      map: fallbackTexture,
      roughness: 0.65,
      metalness: 0,
      envMapIntensity: 0.05
    });
    
    this.jupiter = new THREE.Mesh(jupiterGeometry, jupiterMaterial);
    this.jupiter.receiveShadow = true;
    this.jupiterGroup.add(this.jupiter);

    // Load high-res 8K Jupiter texture (Solar System Scope, CC BY 4.0)
    const textureLoader = this.textureLoader;
    this.loadPromises.push(new Promise<void>((resolve) => {
      textureLoader.load(
        '8k_jupiter.jpg',
        (texture) => {
          if ('SRGBColorSpace' in THREE) {
            texture.colorSpace = (THREE as unknown as { SRGBColorSpace: THREE.ColorSpace }).SRGBColorSpace;
          }
          texture.generateMipmaps = false;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          jupiterMaterial.map = texture;
          jupiterMaterial.needsUpdate = true;
          resolve();
        },
        undefined,
        () => {
          // Fallback to NASA OPAL texture
          textureLoader.load('20181107_hlsp_opal_hst_wfc3-uvis_jupiter-2017a_color_globalmap2.webp', (tex) => {
            if ('SRGBColorSpace' in THREE) {
              tex.colorSpace = (THREE as unknown as { SRGBColorSpace: THREE.ColorSpace }).SRGBColorSpace;
            }
            tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
            tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            jupiterMaterial.map = tex; jupiterMaterial.needsUpdate = true;
            resolve();
          }, undefined, () => { console.warn('Could not load Jupiter texture.'); resolve(); });
        }
      );
    }));

    // Create Earth for scale comparison (Slide 5)
    // Jupiter radius is 10. Earth radius is ~11.2 times smaller, so 10 / 11.2 = 0.89
    const earthGeometry = new THREE.SphereGeometry(0.89, 48, 48);
    const earthMaterial = new THREE.MeshStandardMaterial({
      color: 0x2266cc, // Base blue if texture fails
      roughness: 0.8,
      metalness: 0.05
    });
    
    this.earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    this.earthMesh.castShadow = true;
    this.earthMesh.receiveShadow = true; // Allows clouds to cast shadows onto the surface
    
    // Position Earth to the left and slightly in front of Jupiter so it's clearly visible on slide 5
    // Jupiter is at (12, 0, -15). We want Earth to be near the camera focus on slide 5.
    // Slide 5 camera looks at (0, 6, 0) and is at (0, -18, 22).
    // Let's place Earth at (-8, 2, -5) relative to the scene, which puts it nicely in frame.
    this.earthMesh.position.set(-8, 2, -5);
    this.earthMesh.visible = false; // Hidden by default
    this.scene.add(this.earthMesh);

    // Earth Texture from local 8K asset
    this.loadPromises.push(
      new Promise<void>((resolve) => {
        textureLoader.load(
          '8k_earth_daymap.webp',
          (texture) => {
            if ('SRGBColorSpace' in THREE) {
              texture.colorSpace = (THREE as unknown as { SRGBColorSpace: THREE.ColorSpace }).SRGBColorSpace;
            }
            texture.generateMipmaps = false;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            earthMaterial.map = texture;
            earthMaterial.color.setHex(0xffffff);
            earthMaterial.needsUpdate = true;
            resolve();
          },
          undefined,
          () => { console.warn('Could not load Earth texture.'); resolve(); }
        );
      }),
      new Promise<void>((resolve) => {
        textureLoader.load('2k_earth_normal_map.webp', (tex) => {
          tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
          earthMaterial.normalMap = tex;
          earthMaterial.normalScale = new THREE.Vector2(0.8, 0.8);
          earthMaterial.needsUpdate = true;
          resolve();
        }, undefined, () => resolve());
      }),
      new Promise<void>((resolve) => {
        textureLoader.load('2k_earth_specular_map.webp', (tex) => {
          tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
          earthMaterial.metalnessMap = tex;
          earthMaterial.roughness = 0.65;
          earthMaterial.metalness = 0.15;
          earthMaterial.needsUpdate = true;
          resolve();
        }, undefined, () => resolve());
      })
    );
    // Earth cloud layer — semi-transparent rotating sphere
    const earthCloudGeo = new THREE.SphereGeometry(0.905, 48, 48);
    const earthCloudMat = new THREE.MeshStandardMaterial({
      transparent: true, opacity: 0.65, depthWrite: false,
      color: 0xffffff, roughness: 1, metalness: 0
    });
    this.earthCloudsMesh = new THREE.Mesh(earthCloudGeo, earthCloudMat);
    this.earthCloudsMesh.castShadow = true; // Clouds physically cast shadows onto the Earth
    this.earthMesh.add(this.earthCloudsMesh);
    this.loadPromises.push(new Promise<void>((resolve) => {
      textureLoader.load('2k_earth_clouds.webp', (tex) => {
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
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
        color: 0xbbbbaa, roughness: 0.92, metalness: 0
      });
      this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
      this.moonMesh.visible = false;
      this.scene.add(this.moonMesh);
      this.loadPromises.push(new Promise<void>((resolve) => {
        textureLoader.load('8k_moon.webp', (tex) => {
          tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
          moonMat.map = tex; moonMat.color.setHex(0xffffff); moonMat.needsUpdate = true;
          resolve();
        }, undefined, () => resolve());
      }));

      // ─── Apollo 11 "Tranquility Base" — cinematic moon landing scene ────
      this.tranquilityGroup = new THREE.Group();

      // ── High-Fidelity Terrain Patch (128×128 tessellated plane) ──────
      const terrainSize = 0.08;
      const terrainSeg = 128;
      const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSeg, terrainSeg);
      terrainGeo.rotateX(-Math.PI / 2);
      // Procedural displacement — gentle craters + noise
      const terrainPos = terrainGeo.attributes['position'] as THREE.BufferAttribute;
      const terrainNormals: number[] = [];
      for (let i = 0; i < terrainPos.count; i++) {
        const x = terrainPos.getX(i);
        const z = terrainPos.getZ(i);
        // Multi-octave simplex-like noise via sin combinations
        let h = 0;
        h += Math.sin(x * 280 + 1.3) * Math.cos(z * 310 + 0.7) * 0.0004;
        h += Math.sin(x * 560 + 2.1) * Math.cos(z * 490 + 1.9) * 0.0002;
        h += Math.sin(x * 1100) * Math.cos(z * 1200) * 0.0001;
        // Small crater near center-left
        const cx = x + 0.012, cz = z - 0.005;
        const craterDist = Math.hypot(cx, cz);
        if (craterDist < 0.008) {
          h -= (0.008 - craterDist) * 0.03;
          h += Math.max(0, 0.008 - craterDist - 0.002) * 0.01; // rim
        }
        terrainPos.setY(i, h);
      }
      terrainGeo.computeVertexNormals();
      // Procedural normal map for micro-detail
      const normalCanvas = document.createElement('canvas');
      normalCanvas.width = 256; normalCanvas.height = 256;
      const nCtx = normalCanvas.getContext('2d')!;
      const nImageData = nCtx.createImageData(256, 256);
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const idx = (py * 256 + px) * 4;
          // Procedural bumps
          const nx = Math.sin(px * 0.8 + py * 0.3) * 0.15 + Math.sin(px * 2.1) * 0.1;
          const ny = Math.cos(py * 0.9 + px * 0.2) * 0.15 + Math.cos(py * 1.8) * 0.1;
          nImageData.data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
          nImageData.data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
          nImageData.data[idx + 2] = 200; // Z component (mostly up)
          nImageData.data[idx + 3] = 255;
        }
      }
      nCtx.putImageData(nImageData, 0, 0);
      const terrainNormalTex = new THREE.CanvasTexture(normalCanvas);
      terrainNormalTex.wrapS = THREE.RepeatWrapping;
      terrainNormalTex.wrapT = THREE.RepeatWrapping;
      terrainNormalTex.generateMipmaps = false;
      terrainNormalTex.minFilter = THREE.LinearFilter;
      terrainNormalTex.magFilter = THREE.LinearFilter;

      // Procedural lunar regolith diffuse map — realistic grey variations
      const regolithCanvas = document.createElement('canvas');
      regolithCanvas.width = 512; regolithCanvas.height = 512;
      const rCtx = regolithCanvas.getContext('2d')!;
      // Base regolith grey
      rCtx.fillStyle = '#8a8478';
      rCtx.fillRect(0, 0, 512, 512);
      // Add grain, micro-craters, and color variation
      const rImg = rCtx.getImageData(0, 0, 512, 512);
      for (let py = 0; py < 512; py++) {
        for (let px = 0; px < 512; px++) {
          const idx = (py * 512 + px) * 4;
          // Fine grain noise
          const grain = (Math.random() - 0.5) * 30;
          // Larger variation (gentle patches)
          const patch = Math.sin(px * 0.03 + py * 0.02) * 8 + Math.cos(px * 0.07 - py * 0.05) * 6;
          // Tiny micro-crater darkening
          const cx1 = px - 180, cy1 = py - 220;
          const crater1 = Math.hypot(cx1, cy1) < 12 ? -25 : 0;
          const cx2 = px - 350, cy2 = py - 100;
          const crater2 = Math.hypot(cx2, cy2) < 8 ? -20 : 0;
          const cx3 = px - 90, cy3 = py - 400;
          const crater3 = Math.hypot(cx3, cy3) < 15 ? -30 : 0;
          for (let c = 0; c < 3; c++) {
            rImg.data[idx + c] = Math.max(40, Math.min(200,
              rImg.data[idx + c] + grain + patch + crater1 + crater2 + crater3));
          }
        }
      }
      rCtx.putImageData(rImg, 0, 0);
      const regolithTex = new THREE.CanvasTexture(regolithCanvas);
      regolithTex.wrapS = THREE.RepeatWrapping;
      regolithTex.wrapT = THREE.RepeatWrapping;
      regolithTex.generateMipmaps = false;
      regolithTex.minFilter = THREE.LinearFilter;

      const terrainMat = new THREE.MeshStandardMaterial({
        map: regolithTex,
        roughness: 0.95,
        metalness: 0,
        normalMap: terrainNormalTex,
        normalScale: new THREE.Vector2(0.6, 0.6),
      });
      const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
      terrainMesh.receiveShadow = true;
      this.tranquilityGroup.add(terrainMesh);

      // ── Lunar Module — Enhanced Procedural ──────────────────────────
      const lmGroup = new THREE.Group();

      // Descent Stage — gold-foil octagonal body
      const goldFoilMat = new THREE.MeshStandardMaterial({
        color: 0xccaa44, roughness: 0.35, metalness: 0.75,
        emissive: 0x221800, emissiveIntensity: 0.15,
      });
      const lmBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.018, 0.014, 8),
        goldFoilMat
      );
      lmBody.position.y = 0.014;
      lmBody.castShadow = true;
      lmGroup.add(lmBody);

      // Ascent Stage — upper cabin (lighter grey, boxy)
      const ascentMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.45, metalness: 0.65 });
      const ascentStage = new THREE.Mesh(
        new THREE.BoxGeometry(0.013, 0.011, 0.013),
        ascentMat
      );
      ascentStage.position.y = 0.027;
      ascentStage.castShadow = true;
      lmGroup.add(ascentStage);

      // Triangular windows on ascent stage
      const windowMat = new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.1, metalness: 0.9 });
      for (let side = -1; side <= 1; side += 2) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.003), windowMat);
        win.position.set(side * 0.0066, 0.029, 0);
        win.rotation.y = side * Math.PI / 2;
        lmGroup.add(win);
      }

      // RCS thrusters (small nozzles on the sides)
      const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.8 });
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.0015, 0.004, 6), nozzleMat);
        nozzle.position.set(Math.cos(angle) * 0.008, 0.027, Math.sin(angle) * 0.008);
        nozzle.rotation.z = Math.cos(angle) * 0.5;
        nozzle.rotation.x = Math.sin(angle) * 0.5;
        lmGroup.add(nozzle);
      }

      // Antenna on top with dish
      const antennaMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.4, metalness: 0.7 });
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0004, 0.0004, 0.012, 4), antennaMat);
      antenna.position.y = 0.038;
      lmGroup.add(antenna);
      const antennaDish = new THREE.Mesh(new THREE.CircleGeometry(0.003, 8), antennaMat);
      antennaDish.position.y = 0.044;
      antennaDish.rotation.x = -0.3;
      lmGroup.add(antennaDish);

      // Base plate
      const lmBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 0.003, 8),
        new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3, metalness: 0.8 })
      );
      lmBase.position.y = 0.005;
      lmBase.castShadow = true;
      lmGroup.add(lmBase);

      // 4 landing legs with struts and foot pads
      const legMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.5, metalness: 0.6 });
      for (let i = 0; i < 4; i++) {
        const legAngle = (i / 4) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.016, 4), legMat);
        leg.position.set(Math.cos(legAngle) * 0.013, 0.005, Math.sin(legAngle) * 0.013);
        leg.rotation.z = Math.cos(legAngle) * 0.35;
        leg.rotation.x = Math.sin(legAngle) * 0.35;
        leg.castShadow = true;
        lmGroup.add(leg);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.001, 6), legMat);
        pad.position.set(Math.cos(legAngle) * 0.018, 0.001, Math.sin(legAngle) * 0.018);
        pad.castShadow = true;
        lmGroup.add(pad);
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0005, 0.012, 3), legMat);
        strut.position.set(Math.cos(legAngle) * 0.01, 0.008, Math.sin(legAngle) * 0.01);
        strut.rotation.z = Math.cos(legAngle) * 0.2;
        strut.rotation.x = Math.sin(legAngle) * 0.2;
        lmGroup.add(strut);
      }

      // Descent engine nozzle
      const engineNozzle = new THREE.Mesh(
        new THREE.ConeGeometry(0.005, 0.008, 8, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide })
      );
      engineNozzle.position.y = 0.003;
      engineNozzle.rotation.x = Math.PI;
      lmGroup.add(engineNozzle);

      // Ladder on one leg
      const ladderMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.6 });
      for (let r = 0; r < 5; r++) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.0005, 0.001), ladderMat);
        rung.position.set(0.016, 0.003 + r * 0.003, 0);
        lmGroup.add(rung);
      }

      this.tranquilityGroup.add(lmGroup);

      // ── Footprint Trail — 10 bootprints from ladder outward ─────────
      const bootCanvas = document.createElement('canvas');
      bootCanvas.width = 64; bootCanvas.height = 64;
      const bCtx = bootCanvas.getContext('2d')!;
      bCtx.fillStyle = '#000000';
      bCtx.fillRect(0, 0, 64, 64);
      bCtx.fillStyle = '#444444';
      bCtx.beginPath();
      bCtx.ellipse(32, 32, 12, 22, 0, 0, Math.PI * 2);
      bCtx.fill();
      bCtx.fillStyle = '#333333';
      for (let i = 0; i < 8; i++) {
        bCtx.fillRect(22, 14 + i * 5, 20, 2);
      }
      const bootTex = new THREE.CanvasTexture(bootCanvas);
      bootTex.generateMipmaps = false;
      bootTex.minFilter = THREE.LinearFilter;
      bootTex.magFilter = THREE.LinearFilter;
      const bootMat = new THREE.MeshStandardMaterial({
        map: bootTex, transparent: true, roughness: 1, metalness: 0,
        color: 0x888880,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        depthWrite: false,
      });

      // 10 staggered footprints from the ladder outward
      for (let fp = 0; fp < 10; fp++) {
        const print = new THREE.Mesh(new THREE.PlaneGeometry(0.005, 0.008), bootMat);
        print.rotation.x = -Math.PI / 2;
        const t = fp / 9;
        const xOff = 0.02 + t * 0.025; // walk outward from ladder
        const zOff = (fp % 2 === 0 ? 1 : -1) * 0.003; // left-right stagger
        const yOff = 0.0003; // just above terrain
        print.position.set(xOff, yOff, zOff);
        print.rotation.z = (fp % 2 === 0 ? -0.08 : 0.08) + (Math.random() - 0.5) * 0.06;
        this.tranquilityGroup.add(print);
      }

      // ALSEP science package — seismometer etc.
      const alsep = new THREE.Group();
      const alsepBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.004, 0.003, 0.004),
        new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5, metalness: 0.4 })
      );
      alsepBody.position.y = 0.002;
      alsepBody.castShadow = true;
      alsep.add(alsepBody);
      const solarPanel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.006, 0.003),
        new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.3, metalness: 0.5, side: THREE.DoubleSide })
      );
      solarPanel.position.set(0, 0.004, 0);
      solarPanel.rotation.x = -0.3;
      alsep.add(solarPanel);
      alsep.position.set(-0.03, 0, -0.02);
      this.tranquilityGroup.add(alsep);

      // ── Standing American Flag ─────────────────────────────────────
      const flagGroup = new THREE.Group();
      const flagPole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0005, 0.0005, 0.022, 4),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.6 })
      );
      flagPole.position.y = 0.011;
      flagPole.castShadow = true;
      flagGroup.add(flagPole);
      // Horizontal crossbar
      const crossbar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0003, 0.0003, 0.013, 3),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.6 })
      );
      crossbar.rotation.z = Math.PI / 2;
      crossbar.position.set(-0.0065, 0.0205, 0);
      flagGroup.add(crossbar);
      // US Flag texture via Canvas
      const flagCanvas = document.createElement('canvas');
      flagCanvas.width = 256; flagCanvas.height = 160;
      const fCtx = flagCanvas.getContext('2d')!;
      // Red and white stripes
      const stripeH = 160 / 13;
      for (let s = 0; s < 13; s++) {
        fCtx.fillStyle = s % 2 === 0 ? '#BF0A30' : '#FFFFFF';
        fCtx.fillRect(0, s * stripeH, 256, stripeH);
      }
      // Blue canton
      const cantonW = 102, cantonH = Math.round(stripeH * 7);
      fCtx.fillStyle = '#002868';
      fCtx.fillRect(0, 0, cantonW, cantonH);
      // Stars (simplified 5×4 + 4×3 offset grid → 50 stars approximation)
      fCtx.fillStyle = '#FFFFFF';
      const starRows = [6, 5, 6, 5, 6, 5, 6, 5, 6];
      const rowSpacing = cantonH / 10;
      for (let row = 0; row < starRows.length; row++) {
        const cols = starRows[row];
        const colSpacing = cantonW / (cols + 0.5);
        const offsetX = cols === 5 ? colSpacing * 0.75 : colSpacing * 0.5;
        for (let col = 0; col < cols; col++) {
          const sx = offsetX + col * colSpacing;
          const sy = rowSpacing * (row + 0.7);
          fCtx.beginPath();
          for (let p = 0; p < 5; p++) {
            const a = -Math.PI / 2 + (p * 4 * Math.PI) / 5;
            const r = 2.8;
            if (p === 0) fCtx.moveTo(sx + r * Math.cos(a), sy + r * Math.sin(a));
            else fCtx.lineTo(sx + r * Math.cos(a), sy + r * Math.sin(a));
          }
          fCtx.closePath();
          fCtx.fill();
        }
      }
      const flagTex = new THREE.CanvasTexture(flagCanvas);
      flagTex.generateMipmaps = false;
      flagTex.minFilter = THREE.LinearFilter;
      const flagCloth = new THREE.Mesh(
        new THREE.PlaneGeometry(0.013, 0.008),
        new THREE.MeshStandardMaterial({
          map: flagTex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
          emissive: 0xffffff, emissiveIntensity: 0.08,
        })
      );
      flagCloth.position.set(-0.0065, 0.017, 0);
      flagGroup.add(flagCloth);
      flagGroup.position.set(-0.02, 0, 0.015);
      this.tranquilityGroup.add(flagGroup);

      // ── Lunar landing site illumination ───────────────────────────
      const lunarSun = new THREE.PointLight(0xfff8e8, 1.5, 0.15);
      lunarSun.position.set(0.04, 0.06, 0.02);
      this.tranquilityGroup.add(lunarSun);

      // ── Apollo 11 Plaque on LM leg — "Here men from the planet Earth…" ──
      const plaqueCanvas = document.createElement('canvas');
      plaqueCanvas.width = 256; plaqueCanvas.height = 128;
      const pCtx = plaqueCanvas.getContext('2d')!;
      pCtx.fillStyle = '#888888';
      pCtx.fillRect(0, 0, 256, 128);
      pCtx.fillStyle = '#222222';
      pCtx.font = 'bold 11px serif';
      pCtx.textAlign = 'center';
      pCtx.fillText('HERE MEN FROM THE PLANET EARTH', 128, 25);
      pCtx.fillText('FIRST SET FOOT UPON THE MOON', 128, 42);
      pCtx.fillText('JULY 1969, A.D.', 128, 59);
      pCtx.fillText('WE CAME IN PEACE FOR ALL MANKIND', 128, 76);
      pCtx.font = '9px serif';
      pCtx.fillText('Neil A. Armstrong · Michael Collins · Edwin E. Aldrin Jr.', 128, 100);
      pCtx.fillText('Richard Nixon, President', 128, 116);
      const plaqueTex = new THREE.CanvasTexture(plaqueCanvas);
      plaqueTex.generateMipmaps = false;
      plaqueTex.minFilter = THREE.LinearFilter;
      const plaqueMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.008, 0.004),
        new THREE.MeshStandardMaterial({
          map: plaqueTex, roughness: 0.3, metalness: 0.7,
          emissive: 0xffffff, emissiveIntensity: 0.1,
        })
      );
      plaqueMesh.position.set(0.018, 0.005, 0.002);
      plaqueMesh.rotation.y = -0.3;
      this.tranquilityGroup.add(plaqueMesh);

      // ── Earthrise — small Earth visible above the lunar horizon ─────
      const earthriseGeo = new THREE.SphereGeometry(0.003, 24, 24);
      const earthriseMat = new THREE.MeshStandardMaterial({
        color: 0x4488ff, roughness: 0.6, metalness: 0.1,
        emissive: 0x2244aa, emissiveIntensity: 0.3,
      });
      const earthriseMesh = new THREE.Mesh(earthriseGeo, earthriseMat);
      earthriseMesh.position.set(-0.03, 0.035, -0.025);
      this.tranquilityGroup.add(earthriseMesh);
      // Load the Earthrise photo onto the sphere
      this.loadPromises.push(new Promise<void>((resolve) => {
        textureLoader.load('earthrise.webp', (tex) => {
          tex.generateMipmaps = false;
          tex.minFilter = THREE.LinearFilter;
          earthriseMat.map = tex;
          earthriseMat.color.setHex(0xffffff);
          earthriseMat.needsUpdate = true;
          resolve();
        }, undefined, () => {
          // Fallback — keep the blue sphere
          resolve();
        });
      }));
      // Earthrise glow halo
      const earthGlowMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { glowColor: { value: new THREE.Color(0x88bbff) } },
        vertexShader: `varying vec3 vNormal;void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform vec3 glowColor;varying vec3 vNormal;void main(){float intensity=pow(0.65-dot(vNormal,vec3(0,0,1.0)),2.5);gl_FragColor=vec4(glowColor,intensity*0.4);}`,
        side: THREE.BackSide,
      });
      const earthGlow = new THREE.Mesh(new THREE.SphereGeometry(0.004, 16, 16), earthGlowMat);
      earthGlow.position.copy(earthriseMesh.position);
      this.tranquilityGroup.add(earthGlow);

      // ── Real NASA bootprint texture ──────────────────────────────────
      this.loadPromises.push(new Promise<void>((resolve) => {
        textureLoader.load('bootprint_apollo.webp', (tex) => {
          tex.generateMipmaps = false;
          tex.minFilter = THREE.LinearFilter;
          bootMat.map = tex;
          bootMat.color.setHex(0xffffff);
          bootMat.needsUpdate = true;
          resolve();
        }, undefined, () => resolve());
      }));

      // ── Iconic Aldrin photo billboard near the LM ───────────────────
      const photoGeo = new THREE.PlaneGeometry(0.016, 0.016);
      const photoMat = new THREE.MeshStandardMaterial({
        roughness: 0.8, metalness: 0, side: THREE.DoubleSide,
        transparent: true, opacity: 0,
        emissive: 0xffffff, emissiveIntensity: 0.12,
      });
      const photoBillboard = new THREE.Mesh(photoGeo, photoMat);
      photoBillboard.position.set(0.03, 0.012, -0.015);
      photoBillboard.rotation.y = 0.4;
      this.tranquilityGroup.add(photoBillboard);
      this.loadPromises.push(new Promise<void>((resolve) => {
        textureLoader.load('aldrin_moon.webp', (tex) => {
          tex.generateMipmaps = false;
          tex.minFilter = THREE.LinearFilter;
          photoMat.map = tex;
          photoMat.opacity = 1;
          photoMat.needsUpdate = true;
          resolve();
        }, undefined, () => {
          // Hide billboard if image fails
          photoBillboard.visible = false;
          resolve();
        });
      }));

      // ── Lunar Dust Particle System ──────────────────────────────────
      const lunarDustCount = 200;
      const dustPositions = new Float32Array(lunarDustCount * 3);
      this.lunarDustVelocities = new Float32Array(lunarDustCount * 3);
      this.lunarDustLife = new Float32Array(lunarDustCount);
      for (let d = 0; d < lunarDustCount; d++) {
        dustPositions[d * 3] = 0;
        dustPositions[d * 3 + 1] = -1; // Hidden below ground initially
        dustPositions[d * 3 + 2] = 0;
        this.lunarDustLife[d] = 0;
      }
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
      const dustMat = new THREE.PointsMaterial({
        color: 0xaaa898,
        size: 0.0008,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.lunarDust = new THREE.Points(dustGeo, dustMat);
      this.tranquilityGroup.add(this.lunarDust);

      // Position on Moon surface — Sea of Tranquility
      const theta = 0.41;
      const phi = 0.04;
      const moonR = 0.28;
      this.tranquilityGroup.position.set(
        moonR * Math.cos(phi) * Math.sin(theta),
        moonR * Math.sin(phi),
        moonR * Math.cos(phi) * Math.cos(theta)
      );

      // Align local Y+ with the lunar surface normal so the landing site stands upright.
      const surfaceNormal = this.tranquilityGroup.position.clone().normalize();
      this.tranquilityGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceNormal);
      this.moonMesh.add(this.tranquilityGroup);

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
    ring.rotation.x = Math.PI / 2; // Flat in equatorial plane — group rotation handles tilt
    this.jupiterGroup.add(ring);

    // Gossamer rings (extremely faint, extends to 3.16 Rj)
    const gossamerGeo = new THREE.RingGeometry(18.1, 31.6, 64);
    const gossamerMat = new THREE.MeshBasicMaterial({
      color: 0x887766, transparent: true, opacity: 0.015,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const gossamerRing = new THREE.Mesh(gossamerGeo, gossamerMat);
    gossamerRing.rotation.x = Math.PI / 2;
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

      void main() {
        vec3 viewDirection = normalize(-vPosition);
        vec3 sunDir = normalize(uSunDirection);
        float sunDot = dot(vNormalWorld, sunDir);

        // Improved Rayleigh-like fresnel — higher exponent avoids plastic rim
        float fresnel = pow(clamp(1.0 - dot(viewDirection, vNormal), 0.0, 1.0), 6.0);
        float pulse = mix(1.0, 1.04, uPulse * 0.15);

        // Terminator wrap-around: atmosphere should glow slightly past the shadow line
        float terminator = smoothstep(-0.2, 0.2, sunDot);
        float daySide = smoothstep(-0.05, 0.35, sunDot);
        float terminatorBand = 1.0 - smoothstep(0.0, 0.16, abs(sunDot));

        // Forward scattering through the limb (light shining through the atmosphere edge)
        float forwardScatter = pow(max(dot(viewDirection, sunDir), 0.0), 6.0);

        // Deep orange/red "sunset" band at the terminator edge (Rayleigh scattering through dense gas)
        vec3 sunsetColor = vec3(1.0, 0.35, 0.08);
        float sunsetIntensity = smoothstep(-0.08, 0.06, sunDot) * smoothstep(0.18, 0.0, sunDot);
        vec3 dayColor = mix(vec3(0.92, 0.88, 0.8), vec3(0.98, 0.95, 0.86), daySide);

        // Blend nightside black → sunset orange → day color
        vec3 finalAtmoColor = mix(vec3(0.0), sunsetColor, sunsetIntensity);
        finalAtmoColor = mix(finalAtmoColor, dayColor, daySide);

        // Atmosphere only glows where the sun illuminates, with slight wrap-around at terminator
        float alpha = fresnel * terminator * 0.85;
        alpha += fresnel * terminatorBand * 0.45;
        alpha += fresnel * sunsetIntensity * 0.55;
        alpha += forwardScatter * 0.12;
        alpha *= pulse;

        // CRITICAL: Force absolute zero opacity on the night side so space/planets remain deeply black
        alpha *= smoothstep(-0.05, 0.1, sunDot);

        gl_FragColor = vec4(finalAtmoColor, clamp(alpha, 0.0, 0.3));
      }
    `;

    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        uSunDirection: { value: this.sunPosition.clone().normalize() }
      },
      vertexShader,
      fragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });

    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(10.3, 64, 64), atmosphereMaterial);
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
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.jupiterGroup.add(mesh);
      this.galileanMoons.push({ mesh, distance: config.distance, speed: config.speed, angle: Math.random() * Math.PI * 2 });

      // Load real texture
      this.loadPromises.push(new Promise<void>((resolve) => {
        textureLoader.load(config.texture, (tex) => {
          tex.generateMipmaps = false;
          tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          tex.minFilter = THREE.LinearFilter;
          mat.map = tex; mat.color.setHex(0xffffff); mat.needsUpdate = true;
          resolve();
        }, undefined, () => resolve());
      }));
    });

    // The remaining 91 small moons (Total 95) — GPU-driven orbits via vertex shader
    const smallMoonGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const smallMoonMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
    smallMoonMat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = this.smallMoonTimeUniform;
      shader.vertexShader = 'attribute float aOrbitRadius;\nattribute float aOrbitSpeed;\nattribute float aOrbitAngle;\nattribute float aOrbitInclination;\nuniform float uTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `float currentAngle = aOrbitAngle + uTime * aOrbitSpeed;
         float ca = cos(currentAngle);
         float sa = sin(currentAngle);
         float si = sin(aOrbitInclination);
         float ci = cos(aOrbitInclination);
         vec3 orbitOffset = vec3(aOrbitRadius * ca, aOrbitRadius * sa * si, aOrbitRadius * sa * ci);
         vec3 transformed = position + orbitOffset;`
      );
    };
    this.smallMoons = new THREE.InstancedMesh(smallMoonGeo, smallMoonMat, 91);

    const orbitRadii = new Float32Array(91);
    const orbitSpeeds = new Float32Array(91);
    const orbitAngles = new Float32Array(91);
    const orbitInclinations = new Float32Array(91);
    
    for (let i = 0; i < 91; i++) {
      const isInner = i < 8;
      const distance = isInner ? 12 + Math.random() * 5 : 40 + Math.random() * 50;
      const speed = (Math.random() * 0.005 + 0.001) * (Math.random() > 0.5 ? 1 : -1);
      const angle = Math.random() * Math.PI * 2;
      const inclination = isInner
        ? (Math.random() - 0.5) * 0.1
        : (Math.random() - 0.5) * Math.PI * 0.8;
      
      orbitRadii[i] = distance;
      orbitSpeeds[i] = speed;
      orbitAngles[i] = angle;
      orbitInclinations[i] = inclination;
    }
    
    smallMoonGeo.setAttribute('aOrbitRadius', new THREE.InstancedBufferAttribute(orbitRadii, 1));
    smallMoonGeo.setAttribute('aOrbitSpeed', new THREE.InstancedBufferAttribute(orbitSpeeds, 1));
    smallMoonGeo.setAttribute('aOrbitAngle', new THREE.InstancedBufferAttribute(orbitAngles, 1));
    smallMoonGeo.setAttribute('aOrbitInclination', new THREE.InstancedBufferAttribute(orbitInclinations, 1));
    
    this.jupiterGroup.add(this.smallMoons);

    // Lighting — physically motivated but cinematic
    // Slightly warmer ambient picks up surface detail in shadow regions
    const ambientLight = new THREE.AmbientLight(0x070714, 0.26);
    this.scene.add(ambientLight);

    // Main sun light — warm white (5778 K blackbody ≈ 0xfff5e0)
    // Positioned further away for more realistic parallel-ray feel
    this.sunLight = new THREE.DirectionalLight(0xfff5e0, 3.6);
    this.sunLight.position.copy(this.sunPosition);
    this.scene.add(this.sunLight);

    // Point light at the Sun — natural inverse-square falloff; range increased for greater distance
    const sunPointLight = new THREE.PointLight(0xffeedd, 16, 430, 1.5);
    sunPointLight.position.copy(this.sunPosition);
    this.scene.add(sunPointLight);

    // Dim blue-ish fill from opposite side — scattered light / ISM reflection
    const fillLight = new THREE.DirectionalLight(0x102244, 0.45);
    fillLight.position.set(100, -20, -65);
    this.scene.add(fillLight);

    // Subtle overhead hemisphere fill for readability
    const hemiLight = new THREE.HemisphereLight(0x0a0f1e, 0x000000, 0.2);
    this.scene.add(hemiLight);

    // Warm rim/back light — adds depth by outlining dark-side edges
    const rimLight = new THREE.DirectionalLight(0xffd6a8, 0.2);
    rimLight.position.set(40, -20, -60);
    this.scene.add(rimLight);

    // Earthshine — faint blue fill from Earth's reflected light onto the Moon
    this.earthshineLight = new THREE.DirectionalLight(0x4488ff, 0.06);
    this.earthshineLight.position.set(10, 5, -5);
    this.scene.add(this.earthshineLight);
    this.scene.add(this.earthshineLight.target);

    // Cinematic Anamorphic Lens Flare
    const flareGeo = new THREE.PlaneGeometry(42, 42);
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
          float intensity = clamp(core + streak + streak2 * 1.5, 0.0, 1.0) * 0.6;
          gl_FragColor = vec4(color * intensity, intensity * 0.9);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true
    });
    this.sunFlare = new THREE.Mesh(flareGeo, flareMat);
    this.sunFlare.position.copy(this.sunLight.position);
    this.scene.add(this.sunFlare);

    // Post-processing (vignette, grain, color grading) handled by CinematicGradingEffect in PostProcessManager

    // Add spaceships
    this.createSpaceships();

    // Death Star with superlaser
    this.createDeathStar();

    // Lightsaber duel removed by request.

    // Galaxy effects for deep-space feel
    this.createGalaxyEffects();
    this.createStarClusters();

    // Solar system planets: Saturn, Mars
    this.createSolarSystemPlanets();

    // SpaceX Falcon 9 rocket (launches from Earth during tour)
    this.falconGroup = this.buildFalcon9();
    this.scene.add(this.falconGroup);

    // Starman Easter Egg — Tesla Roadster drifting in solar orbit
    this.createStarman();

    // Asteroid belt between Mars and Jupiter
    this.createAsteroidBelt();

    // Asbjørn meteorite constellation (subtle background easter egg)
    this.createAsbjornMeteorStorm();

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

    // Subtle cross constellation tribute in deep sky
    this.createCrossConstellation();

    // Floating astronaut near Tesla Roadster
    this.createFloatingAstronaut();

    // Fallen astronaut memorial plaque
    this.createFallenAstronautMemorial();

    // Columbia memorial sequence (before jupiter-einde)
    this.createColumbiaMemorial();

    await this.initializeTheatreCamera();
    this.updateCameraForSlide(this.slideId);

    this.bootstrapManagers();
  }

  private async initializeTheatreStudio() {
    if (!this.isBrowser) return;

    const host = globalThis.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return;

    const studioModule = await import('@theatre/studio');
    const theatreStateHash = this.hashTheatreState(JSON.stringify(THEATRE_CAMERA_PROJECT_STATE));
    studioModule.default.initialize({ persistenceKey: `spreekbeurt-theatre-studio-${theatreStateHash}` });
  }

  private hashTheatreState(value: string): string {
    let hash = 5381;

    for (let index = 0; index < value.length; index++) {
      hash = ((hash << 5) + hash) ^ (value.codePointAt(index) ?? 0);
    }

    return (hash >>> 0).toString(36);
  }

  private async initializeTheatreCamera() {
    await this.initializeTheatreStudio();

    const project = getProject('spreekbeurt-camera', { state: THEATRE_CAMERA_PROJECT_STATE });
    await project.ready;
    const sheet = project.sheet('slide-camera');
    const theatreCameraObject = sheet.object('jupiter-camera', this.theatreCameraValues as never);
    this.theatreCameraObject = theatreCameraObject;
    sheet.sequence.position = this.getTheatreSequencePosition(this.slideId);
    this.theatreCurrentSequencePosition = sheet.sequence.position;
    this.theatreCameraUnsubscribe?.();
    this.theatreCameraUnsubscribe = theatreCameraObject.onValuesChange((values) => {
      const nextValues = values as unknown as TheatreCameraRig;
      this.theatreCameraValues = nextValues;
      this.cameraLerpSpeed = nextValues.lerp;
      this.cameraDriftSpeedX = nextValues.drift.x;
      this.cameraDriftSpeedY = nextValues.drift.y;
      this.cameraDriftSpeedZ = nextValues.drift.z;
      if (this.sunFlare) {
        this.sunFlare.visible = nextValues.flareVisible;
      }
    });
  }

  private getTheatreSequencePosition(id: string): number {
    return THEATRE_SLIDE_SEQUENCE_POSITIONS[id as keyof typeof THEATRE_SLIDE_SEQUENCE_POSITIONS] ?? 0;
  }

  private getTheatreSequencePositionForKey(key: string): number {
    if (key in THEATRE_TOUR_SEQUENCE_POSITIONS) {
      return THEATRE_TOUR_SEQUENCE_POSITIONS[key as keyof typeof THEATRE_TOUR_SEQUENCE_POSITIONS];
    }

    if (key in THEATRE_SLIDE_SEQUENCE_POSITIONS) {
      return THEATRE_SLIDE_SEQUENCE_POSITIONS[key as keyof typeof THEATRE_SLIDE_SEQUENCE_POSITIONS];
    }

    return THEATRE_SLIDE_SEQUENCE_POSITIONS.title;
  }

  private transitionTheatreCameraToSlide(id: string) {
    this.transitionTheatreCameraToKey(id);
  }

  private transitionTheatreCameraToKey(key: string) {
    const sequence = this.theatreCameraObject?.sheet.sequence;
    if (!sequence) return;

    const targetPosition = this.getTheatreSequencePositionForKey(key);
    const currentPosition = sequence.position;

    // Moon stop uses local-space offsets; interpolating from world-space
    // values would fling the camera wildly, so snap instantly.
    // Columbia is far from every other object — snap to avoid slow pan.
    if (key === 'maan' || key === 'columbia') {
      sequence.pause();
      sequence.position = targetPosition;
      this.theatreCurrentSequencePosition = targetPosition;
      return;
    }

    if (Math.abs(targetPosition - currentPosition) < 0.001) {
      sequence.position = targetPosition;
      this.theatreCurrentSequencePosition = targetPosition;
      return;
    }

    sequence.pause();
    sequence.position = currentPosition;
    this.theatreCurrentSequencePosition = currentPosition;
    const movingForward = targetPosition >= currentPosition;
    const distance = Math.abs(targetPosition - currentPosition);
    void sequence.play({
      range: movingForward ? [currentPosition, targetPosition] : [targetPosition, currentPosition],
      direction: movingForward ? 'normal' : 'reverse',
      rate: Math.max(1.25, distance * 2.2),
    }).then(() => {
      this.theatreCurrentSequencePosition = targetPosition;
    });
  }

  private getSlideCameraAnchor(): THREE.Vector3 {
    return this.jupiterGroup?.position ?? new THREE.Vector3(12, 0, -15);
  }

  private getCameraAnchorForKey(key: string): THREE.Vector3 {
    switch (key) {
      case 'falcon-launch':
      case 'falcon-landing':
        return this.falconCameraAnchor;
      case 'zon':
        return this.sunMesh?.position ?? this.getSlideCameraAnchor();
      case 'mercurius':
        return this.mercuryMesh?.position ?? this.getSlideCameraAnchor();
      case 'venus':
        return this.venusMesh?.position ?? this.getSlideCameraAnchor();
      case 'aarde':
        return this.earthMesh?.position ?? this.getSlideCameraAnchor();
      case 'maan': {
        // Use Tranquility Base world position so camera tracks the landing site
        if (this.tranquilityGroup) {
          const wp = new THREE.Vector3();
          this.tranquilityGroup.getWorldPosition(wp);
          return wp;
        }
        return this.moonMesh?.position ?? this.getSlideCameraAnchor();
      }
      case 'mars':
        return this.marsMesh?.position ?? this.getSlideCameraAnchor();
      case 'starman':
        return this.starmanGroup?.position ?? this.getSlideCameraAnchor();
      case 'saturnus':
        return this.saturnGroup?.position ?? this.getSlideCameraAnchor();
      case 'uranus':
        return this.uranusGroup?.position ?? this.getSlideCameraAnchor();
      case 'neptunus':
        return this.neptuneGroup?.position ?? this.getSlideCameraAnchor();
      case 'pluto':
        return this.plutoMesh?.position ?? this.getSlideCameraAnchor();
      case 'blackhole':
        return this.blackHoleGroup?.position ?? this.getSlideCameraAnchor();
      case 'columbia':
        return this.columbiaGroup?.position ?? this.getSlideCameraAnchor();
      case 'jupiter':
      case 'jupiter-einde':
      default:
        return this.getSlideCameraAnchor();
    }
  }

  private updateAtmosphere(time: number) {
    if (this.atmosphere) {
      const pulseScale = 1 + Math.sin(time * 3) * 0.03 * this.currentAtmospherePulse;
      this.atmosphere.scale.set(pulseScale, pulseScale, pulseScale);

      // Cloud parallax: atmosphere rotates ~15% faster than the surface layer
      this.atmosphere.rotation.y += this.currentJupiterSpinSpeed * 0.15;

      const mat = this.atmosphere.material as THREE.ShaderMaterial;
      if (mat.uniforms) {
        mat.uniforms['uTime'].value = time;
        mat.uniforms['uPulse'].value = this.currentAtmospherePulse;
        if (this.sunMesh && this.jupiterGroup) {
          const sunDirection = this.sunMesh.position.clone().sub(this.jupiterGroup.position).normalize();
          mat.uniforms['uSunDirection'].value.copy(sunDirection);
        }
      }
    }
  }

  private updateCamera() {
    if (!this.camera) {
      return;
    }

    // Adjust near plane for moon close-up (terrain is only 0.08 units)
    const desiredNear = (this.activeCameraAnchorKey === 'maan' && this.tranquilityGroup) ? 0.001 : 0.1;
    if (this.camera.near !== desiredNear) {
      this.camera.near = desiredNear;
      this.camera.updateProjectionMatrix();
    }

    if (this.userInteracting) {
      this.controls.enabled = true;
      this.controls.update();
      return;
    }

    this.controls.enabled = false;

    const breathing = this.updateCameraDrift();
    if (!this.falconLaunched) {
      this.updateAutomaticCameraTargets(breathing);
    }

    const effectiveLerp = this.cameraLerpSpeed * 3.0;
    this.camera.position.x += (this.targetCameraX - this.camera.position.x) * effectiveLerp;
    this.camera.position.y += (this.targetCameraY - this.camera.position.y) * effectiveLerp;
    this.camera.position.z += (this.targetCameraZ - this.camera.position.z) * effectiveLerp;

    this.currentLookAt.lerp(this.targetLookAt, effectiveLerp);
    this.controls.target.copy(this.currentLookAt);
    this.controls.update();
  }

  private updateCameraDrift(): CameraBreathing {
    if (this.prefersReducedMotion) {
      this.cameraDriftX = 0;
      this.cameraDriftY = 0;
      this.cameraDriftZ = 0;
      this.camera.rotation.z = 0;
      this.cameraBreathing.set(0, 0, 0);
      return this.cameraBreathing;
    }

    const driftTime = (Date.now() - this.startTime) * 0.001 - this.slideStartTime;
    const t = driftTime * 0.5;
    const breatheX = Math.sin(t * 0.23) + Math.sin(t * 0.61) * 0.4;
    const breatheY = Math.cos(t * 0.29) + Math.sin(t * 0.73) * 0.35;
    const breatheZ = Math.sin(t * 0.19) + Math.cos(t * 0.53) * 0.45;

    this.cameraDriftX = breatheX * Math.abs(this.cameraDriftSpeedX) * 2;
    this.cameraDriftY = breatheY * Math.abs(this.cameraDriftSpeedY) * 2;
    this.cameraDriftZ = breatheZ * Math.abs(this.cameraDriftSpeedZ) * 2;

    const targetRoll = breatheX * 0.0005;
    this.camera.rotation.z += (targetRoll - this.camera.rotation.z) * 0.02;
    this.cameraBreathing.set(breatheX, breatheY, breatheZ);
    return this.cameraBreathing;
  }

  private updateAutomaticCameraTargets(breathing: CameraBreathing) {
    if (this.activeCameraAnchorKey === 'maan' && this.tranquilityGroup) {
      this.updateMoonCameraTargets(breathing);
      return;
    }

    this.updateWorldCameraTargets();
  }

  private updateMoonCameraTargets(breathing: CameraBreathing) {
    this.moonLocalCameraOffset.set(
      this.theatreCameraValues.offset.x + breathing.x * this.theatreCameraValues.drift.x,
      this.theatreCameraValues.offset.y + breathing.y * this.theatreCameraValues.drift.y,
      this.theatreCameraValues.offset.z + breathing.z * this.theatreCameraValues.drift.z,
    );

    this.moonLocalLookOffset.set(
      this.theatreCameraValues.lookOffset.x,
      this.theatreCameraValues.lookOffset.y,
      this.theatreCameraValues.lookOffset.z,
    );

    this.moonWorldCameraPosition.copy(this.moonLocalCameraOffset);
    this.moonWorldLookPosition.copy(this.moonLocalLookOffset);
    this.tranquilityGroup.localToWorld(this.moonWorldCameraPosition);
    this.tranquilityGroup.localToWorld(this.moonWorldLookPosition);

    this.baseCameraX = this.moonWorldCameraPosition.x;
    this.baseCameraY = this.moonWorldCameraPosition.y;
    this.baseCameraZ = this.moonWorldCameraPosition.z;

    // Multiply mouse parallax by 0.15 for a subtle, premium cinematic sway rather than wild swinging
    this.targetCameraX = this.baseCameraX + this.mouseX * this.theatreCameraValues.mouseParallax.x * 0.15;
    this.targetCameraY = this.baseCameraY + this.mouseY * this.theatreCameraValues.mouseParallax.y * 0.15;
    this.targetCameraZ = this.baseCameraZ + this.mouseX * this.theatreCameraValues.mouseParallax.z * 0.15;

    this.targetLookAt.copy(this.moonWorldLookPosition);
  }

  private updateWorldCameraTargets() {
    const anchor = this.getCameraAnchorForKey(this.activeCameraAnchorKey);
    this.baseCameraX = anchor.x + this.theatreCameraValues.offset.x;
    this.baseCameraY = anchor.y + this.theatreCameraValues.offset.y;
    this.baseCameraZ = anchor.z + this.theatreCameraValues.offset.z;

    // Multiply mouse parallax by 0.15 for a subtle, premium cinematic sway rather than wild swinging
    this.targetCameraX = this.baseCameraX + this.mouseX * this.theatreCameraValues.mouseParallax.x * 0.15 + this.cameraDriftX;
    this.targetCameraY = this.baseCameraY + this.mouseY * this.theatreCameraValues.mouseParallax.y * 0.15 + this.cameraDriftY;
    this.targetCameraZ = this.baseCameraZ + this.mouseX * this.theatreCameraValues.mouseParallax.z * 0.15 + this.cameraDriftZ;

    this.targetLookAt.set(
      anchor.x + this.theatreCameraValues.lookOffset.x,
      anchor.y + this.theatreCameraValues.lookOffset.y,
      anchor.z + this.theatreCameraValues.lookOffset.z,
    );
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
  private updateMoons(time: number) {
    this.galileanMoons.forEach(moon => {
      moon.angle += moon.speed * this.currentMoonSpeedMultiplier;
      moon.mesh.position.x = Math.cos(moon.angle) * moon.distance;
      moon.mesh.position.z = Math.sin(moon.angle) * moon.distance;
      moon.mesh.rotation.y += 0.01 * this.currentMoonSpeedMultiplier;
    });

    // Small moons orbit entirely on GPU — just update the time uniform
    this.smallMoonTimeUniform.value = time * this.currentMoonSpeedMultiplier;
  }

  private updateStarsAndDust(time: number) {
    if (this.stars) {
      this.updateStarField(time);
    }

    if (this.dustSystem) {
      this.updateDustField();
    }

    this.nebulae.forEach(mesh => this.updateShaderTime(mesh, time));

    if (this.galaxyBand) {
      this.updateShaderTime(this.galaxyBand, time);
    }
  }

  private updateStarField(time: number) {
    this.stars.rotation.y += this.currentStarSpeed;
    this.stars.rotation.x += this.currentStarSpeed * 0.5;
    this.updateShaderTime(this.stars, time);
  }

  private updateDustField() {
    this.dustSystem.rotation.y += this.currentStarSpeed * 3;
    this.dustSystem.rotation.x += this.currentStarSpeed;

    if (this.currentStarSpeed <= 0.001) {
      return;
    }

    const positions = this.dustSystem.geometry.attributes['position'] as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      let z = positions.getZ(index) + this.currentStarSpeed * 300;
      if (z > 50) z -= 100;
      positions.setZ(index, z);
    }
    positions.needsUpdate = true;
  }

  private updateShaderTime(object: { material: THREE.Material | THREE.Material[] }, time: number) {
    const material = object.material;
    if (material instanceof THREE.ShaderMaterial && material.uniforms) {
      material.uniforms['uTime'].value = time;
    }
  }

  private getSpaceshipTrailColor(type: string): number {
    if (type === 'tie') return 0x4466ff;
    if (type === 'shuttle') return 0x4488ff;
    return 0xff5577;
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

      // Create ribbon trail — glowing line tracing the ship's flight path
      const trailLength = 20;
      const trailPositions = new Float32Array(trailLength * 3);
      for (let i = 0; i < trailLength; i++) {
        trailPositions[i * 3] = group.position.x;
        trailPositions[i * 3 + 1] = group.position.y;
        trailPositions[i * 3 + 2] = group.position.z;
      }
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
      const trailColor = this.getSpaceshipTrailColor(cfg.type);
      const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
        color: trailColor, transparent: true, opacity: 0.25,
        blending: THREE.AdditiveBlending
      }));
      trailLine.frustumCulled = false;
      this.scene.add(trailLine);

      this.spaceshipData.push({
        group,
        orbitRadius: cfg.radius,
        orbitSpeed: cfg.speed,
        orbitAngle: angle,
        orbitY: cfg.y,
        orbitInclination: cfg.incl,
        trail: trailLine,
        trailLength,
      });
    });
  }

  private createDeathStar() {
    this.deathStarGroup = new THREE.Group();

    // Load high-fidelity GLB model
    const loader = new GLTFLoader();
    this.loadPromises.push(new Promise<void>((resolve) => {
      loader.load('death_star_-_star_wars.glb', (gltf) => {
        const model = gltf.scene;
        // Normalize the model to fit our scene scale (~radius 4)
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 8 / maxDim; // diameter 8 = radius 4
        model.scale.setScalar(scale);
        // Center the model
        const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
        model.position.sub(center);
        this.deathStarGroup.add(model);
        resolve();
      }, undefined, () => {
        console.warn('Could not load Death Star GLB, using procedural fallback.');
        this.createDeathStarFallback();
        resolve();
      });
    }));

    // Superlaser beam — originates from the concave dish (top-hemisphere)
    // The beam geometry is a tapered cylinder; the pivot is at y=0 of the geometry
    // so we translate the geometry so the base sits at the dish
    const beamGeo = new THREE.CylinderGeometry(0.06, 0.25, 50, 12);
    beamGeo.translate(0, 25, 0); // Shift so base at origin, tip at y=50
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          // Core brightness fades along length, radial falloff for glow edge
          float radial = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float along = 1.0 - vUv.y * 0.4;
          float core = pow(radial, 3.0) * along;
          float glow = pow(radial, 1.2) * along * 0.3;
          vec3 col = mix(vec3(0.2, 1.0, 0.2), vec3(0.7, 1.0, 0.7), core);
          float alpha = (core + glow) * uOpacity;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.superlaserBeam = new THREE.Mesh(beamGeo, beamMat);
    // Position at the concave dish — top of the sphere, slightly indented
    this.superlaserBeam.position.set(0, 3.2, 0);
    // Point outward from the dish (fire "up" in local space = away from planet center)
    this.superlaserBeam.visible = false;
    this.deathStarGroup.add(this.superlaserBeam);

    // Position near Jupiter
    const jp = this.jupiterGroup.position;
    this.deathStarGroup.position.set(jp.x + 45, jp.y + 12, jp.z - 30);
    this.scene.add(this.deathStarGroup);
  }

  /** Procedural fallback if the GLB fails to load */
  private createDeathStarFallback() {
    const dsGeo = new THREE.SphereGeometry(4, 48, 48);
    const dsMat = new THREE.MeshStandardMaterial({
      color: 0x888888, metalness: 0.8, roughness: 0.4,
      emissive: 0x0a0a0a, emissiveIntensity: 0.2,
    });
    this.deathStarGroup.add(new THREE.Mesh(dsGeo, dsMat));
    const trenchGeo = new THREE.TorusGeometry(4.01, 0.15, 8, 64);
    const trenchMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.2 });
    const trench = new THREE.Mesh(trenchGeo, trenchMat);
    trench.rotation.x = Math.PI / 2;
    this.deathStarGroup.add(trench);
    const panelGeo = new THREE.IcosahedronGeometry(4.02, 3);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x777777, metalness: 0.85, roughness: 0.35,
      wireframe: true, transparent: true, opacity: 0.15,
    });
    this.deathStarGroup.add(new THREE.Mesh(panelGeo, panelMat));
  }

  private updateDeathStar(time: number) {
    if (!this.deathStarGroup) return;
    // Slow rotation
    this.deathStarGroup.rotation.y += 0.0003;

    if (this.handlePlutoAttackSequence(time)) {
      return;
    }

    if (this.updatePlutoAftermath(time)) {
      return;
    }

    this.updatePeriodicSuperlaser(time);
  }

  private handlePlutoAttackSequence(time: number): boolean {
    if (!this.deathStarPlutoAttackStarted || this.plutoDestroyed) {
      return false;
    }

    const flyElapsed = time - this.deathStarPlutoFlyTime;
    const flyDuration = 4;
    const plutoPos = this.plutoMesh?.position;
    if (!plutoPos) {
      return true;
    }

    if (flyElapsed < flyDuration) {
      this.updateDeathStarApproach(plutoPos, flyElapsed, flyDuration);
    } else if (flyElapsed < flyDuration + 0.5) {
      this.chargeSuperlaserAtPluto(plutoPos, flyElapsed - flyDuration);
    } else if (flyElapsed < flyDuration + 2) {
      this.fireSuperlaserAtPluto();
    } else {
      this.destroyPluto(time);
    }

    return !this.plutoDestroyed;
  }

  private updateDeathStarApproach(plutoPos: THREE.Vector3, flyElapsed: number, flyDuration: number) {
    const t = flyElapsed / flyDuration;
    const ease = t * t * (3 - 2 * t);
    const jp = this.jupiterGroup.position;
    this.deathStarGroup.position.set(
      jp.x + 45 + (plutoPos.x - 6 - (jp.x + 45)) * ease,
      jp.y + 12 + (plutoPos.y + 3 - (jp.y + 12)) * ease,
      jp.z - 30 + (plutoPos.z - 6 - (jp.z - 30)) * ease
    );
  }

  private chargeSuperlaserAtPluto(plutoPos: THREE.Vector3, chargeElapsed: number) {
    if (!this.superlaserFiring) {
      this.superlaserFiring = true;
      this.superlaserTimer = chargeElapsed;
      this.superlaserBeam.visible = true;
      this.superlaserBeam.lookAt(
        plutoPos.x - this.deathStarGroup.position.x,
        plutoPos.y - this.deathStarGroup.position.y,
        plutoPos.z - this.deathStarGroup.position.z
      );
      const dist = this.deathStarGroup.position.distanceTo(plutoPos);
      this.superlaserBeam.scale.set(1, dist / 50, 1);
    }
    const mat = this.superlaserBeam.material as THREE.ShaderMaterial;
    mat.uniforms['uOpacity'].value = (chargeElapsed / 0.5) * 0.9;
  }

  private fireSuperlaserAtPluto() {
    const mat = this.superlaserBeam.material as THREE.ShaderMaterial;
    const time = (Date.now() - this.startTime) * 0.001;
    mat.uniforms['uOpacity'].value = 0.7 + Math.sin(time * 40) * 0.15;
  }

  private destroyPluto(time: number) {
    this.plutoDestroyed = true;
    this.plutoExplosionTime = time;
    if (this.plutoMesh) this.plutoMesh.visible = false;
    this.superlaserBeam.visible = false;
    this.superlaserFiring = false;
    if (this.plutoDebris) this.plutoDebris.visible = true;
    this.postProcessManager?.setBloomIntensity(8);
    if (this.plutoFlashLight) this.plutoFlashLight.intensity = 200;
    if (this.plutoShockwave) {
      (this.plutoShockwave.material as THREE.MeshBasicMaterial).opacity = 1;
    }
  }

  private updatePlutoAftermath(time: number): boolean {
    if (this.plutoExplosionTime < 0) {
      return false;
    }

    const expTime = time - this.plutoExplosionTime;
    this.updatePlutoFlash(expTime);
    this.updatePlutoShockwave(expTime);
    this.updatePlutoDebrisField();
    this.updateJulianaConstellation(expTime);
    return true;
  }

  private updatePlutoFlash(expTime: number) {
    if (expTime >= 1) {
      return;
    }

    const bloom = Math.max(1.6, 8 - expTime * 6.4);
    this.postProcessManager?.setBloomIntensity(bloom);
    if (this.plutoFlashLight) {
      this.plutoFlashLight.intensity = Math.max(0, 200 - expTime * 200);
    }
  }

  private updatePlutoShockwave(expTime: number) {
    if (!this.plutoShockwave) {
      return;
    }

    this.plutoShockwave.scale.setScalar(1 + expTime * 20);
    const shockMat = this.plutoShockwave.material as THREE.MeshBasicMaterial;
    shockMat.opacity = Math.max(0, 1 - expTime * 1.5);
  }

  private updatePlutoDebrisField() {
    if (!this.plutoDebris || !this.plutoDebrisVelocities) {
      return;
    }

    const dummy = new THREE.Object3D();
    for (let index = 0; index < this.plutoDebris.count; index++) {
      this.plutoDebris.getMatrixAt(index, dummy.matrix);
      dummy.position.setFromMatrixPosition(dummy.matrix);
      dummy.position.x += this.plutoDebrisVelocities[index * 3] * 0.05;
      dummy.position.y += this.plutoDebrisVelocities[index * 3 + 1] * 0.05;
      dummy.position.z += this.plutoDebrisVelocities[index * 3 + 2] * 0.05;
      dummy.rotation.setFromRotationMatrix(dummy.matrix);
      dummy.rotation.x += 0.02;
      dummy.rotation.y += 0.02;
      dummy.updateMatrix();
      this.plutoDebris.setMatrixAt(index, dummy.matrix);
    }
    this.plutoDebris.instanceMatrix.needsUpdate = true;
  }

  private updateJulianaConstellation(expTime: number) {
    if (expTime <= 3.0 || !this.julianaStars) {
      return;
    }

    const starMat = this.julianaStars.material as THREE.ShaderMaterial;
    starMat.uniforms['uOpacity'].value = Math.min(1, (expTime - 3.0) * 1.05);
  }

  private updatePeriodicSuperlaser(time: number) {
    if (!this.superlaserFiring && time - this.superlaserTimer > 30) {
      this.superlaserFiring = true;
      this.superlaserTimer = time;
      this.superlaserBeam.visible = true;
    }

    if (!this.superlaserFiring) {
      return;
    }

    const elapsed = time - this.superlaserTimer;
    const mat = this.superlaserBeam.material as THREE.ShaderMaterial;
    if (elapsed < 0.5) {
      const t = elapsed / 0.5;
      mat.uniforms['uOpacity'].value = t * 0.9;
      this.superlaserBeam.scale.set(t, 1, t);
      return;
    }

    if (elapsed < 1.8) {
      const flicker = 0.7 + Math.sin(elapsed * 40) * 0.15;
      mat.uniforms['uOpacity'].value = flicker;
      this.superlaserBeam.scale.set(1, 1, 1);
      return;
    }

    if (elapsed < 2.2) {
      const t = 1 - (elapsed - 1.8) / 0.4;
      mat.uniforms['uOpacity'].value = t * 0.9;
      this.superlaserBeam.scale.set(t, 1, t);
      return;
    }

    mat.uniforms['uOpacity'].value = 0;
    this.superlaserBeam.visible = false;
    this.superlaserFiring = false;
  }

  private createPlutoExplosionVFX() {
    if (!this.plutoMesh) return;

    // 1. Shockwave Ring
    const ringGeo = new THREE.RingGeometry(0.1, 0.5, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x88ff88,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.plutoShockwave = new THREE.Mesh(ringGeo, ringMat);
    this.plutoShockwave.position.copy(this.plutoMesh.position);
    this.plutoShockwave.lookAt(0, 0, 0);
    this.scene.add(this.plutoShockwave);

    // 2. Blinding Flash
    this.plutoFlashLight = new THREE.PointLight(0xaaffaa, 0, 150);
    this.plutoFlashLight.position.copy(this.plutoMesh.position);
    this.scene.add(this.plutoFlashLight);

    // 3. Shattered Debris — 400 spinning rock chunks
    const debrisCount = 400;
    const rockGeo = new THREE.IcosahedronGeometry(0.08, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xc4a882, roughness: 1 });
    this.plutoDebris = new THREE.InstancedMesh(rockGeo, rockMat, debrisCount);
    this.plutoDebrisVelocities = new Float32Array(debrisCount * 3);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < debrisCount; i++) {
      dummy.position.copy(this.plutoMesh.position);
      const vDir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize().multiplyScalar(0.5 + Math.random() * 2.5);
      this.plutoDebrisVelocities[i * 3] = vDir.x;
      this.plutoDebrisVelocities[i * 3 + 1] = vDir.y;
      this.plutoDebrisVelocities[i * 3 + 2] = vDir.z;
      dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      dummy.updateMatrix();
      this.plutoDebris.setMatrixAt(i, dummy.matrix);
    }
    this.plutoDebris.visible = false;
    this.scene.add(this.plutoDebris);

    // 4. "JULIANASCHOOL" Constellation (Canvas to Particles)
    const canvas = document.createElement('canvas');
    canvas.width = 2048; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '900 230px "Pathway Gothic One", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('JULIANASCHOOL', canvas.width / 2, canvas.height / 2);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const starPositions: number[] = [];
    const starColors: number[] = [];
    const starSizes: number[] = [];

    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const idx = (y * canvas.width + x) * 4;
        if (imgData[idx] > 32) {
          const px = (x - canvas.width / 2) * 0.009;
          const py = -(y - canvas.height / 2) * 0.009;
          const pz = (Math.random() - 0.5) * 0.2;
          starPositions.push(px, py, pz);
          const isGold = Math.random() > 0.4;
          const color = new THREE.Color(isGold ? 0xffe81f : 0xaaccff);
          starColors.push(color.r, color.g, color.b);
          starSizes.push(Math.random() * 5 + 3.4);
        }
      }
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    starGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(starSizes, 1));

    const starMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: `
        attribute float aSize;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (190.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float glow = exp(-d * 4.5);
          gl_FragColor = vec4(vColor, glow * min(1.0, uOpacity * 1.15));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.julianaStars = new THREE.Points(starGeo, starMat);
    this.julianaStars.position.copy(this.plutoMesh.position);
    this.julianaStars.position.y += 3;
    // Face toward the camera approach direction (pluto tour offset is roughly +x,+y,+z)
    this.julianaStars.lookAt(
      this.plutoMesh.position.x + 8,
      this.plutoMesh.position.y + 6,
      this.plutoMesh.position.z + 8,
    );
    this.scene.add(this.julianaStars);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBTLE CROSS CONSTELLATION — distant golden cross in the deep star field
  // ═══════════════════════════════════════════════════════════════════════════
  private createCrossConstellation() {
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];

    // Cross: vertical beam (7 points) + horizontal beam (5 points)
    const crossPts: [number, number][] = [
      [0, -3], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [0, 3],
      [-2, 1], [-1, 1], [1, 1], [2, 1],
    ];

    for (const [cx, cy] of crossPts) {
      const cluster = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < cluster; j++) {
        positions.push(
          cx * 1.2 + (Math.random() - 0.5) * 0.6,
          cy * 1.2 + (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.4,
        );
        const w = 0.7 + Math.random() * 0.3;
        colors.push(1.0, 0.92 * w, 0.6 * w);
        sizes.push(1.0 + Math.random() * 2.0);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aSize;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (200.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float glow = exp(-d * 5.0);
          gl_FragColor = vec4(vColor, glow * 0.6);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.crossConstellation = new THREE.Points(geo, mat);
    this.crossConstellation.position.set(200, 160, -300);
    this.crossConstellation.scale.setScalar(2.5);
    this.crossConstellation.visible = false;
    this.scene.add(this.crossConstellation);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLOATING ASTRONAUT — EVA figure near the Tesla Roadster
  // ═══════════════════════════════════════════════════════════════════════════
  private createFloatingAstronaut() {
    this.astronautGroup = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6, metalness: 0.1 });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.1, 2, 2, 2), suitMat);
    this.astronautGroup.add(torso);

    // Life-support backpack
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.14, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.7, metalness: 0.15 }),
    );
    pack.position.set(0, 0, -0.07);
    this.astronautGroup.add(pack);

    // Helmet
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), suitMat);
    helmet.position.y = 0.13;
    this.astronautGroup.add(helmet);

    // Gold visor
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x112244, roughness: 0.1, metalness: 0.9 }),
    );
    visor.position.set(0, 0.135, 0.015);
    visor.rotation.x = -0.2;
    this.astronautGroup.add(visor);

    // Arms — floating EVA pose
    const armGeo = new THREE.CylinderGeometry(0.025, 0.022, 0.14, 8);
    const leftArm = new THREE.Mesh(armGeo, suitMat);
    leftArm.position.set(-0.09, 0.02, 0);
    leftArm.rotation.set(-0.3, 0, 0.8);
    this.astronautGroup.add(leftArm);
    const rightArm = new THREE.Mesh(armGeo, suitMat);
    rightArm.position.set(0.09, 0.02, 0);
    rightArm.rotation.set(0.2, 0, -0.8);
    this.astronautGroup.add(rightArm);

    // Gloves
    const gloveGeo = new THREE.SphereGeometry(0.018, 8, 8);
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
    const lg = new THREE.Mesh(gloveGeo, gloveMat);
    lg.position.set(-0.15, 0.07, -0.03);
    this.astronautGroup.add(lg);
    const rg = new THREE.Mesh(gloveGeo, gloveMat);
    rg.position.set(0.15, 0.07, 0.02);
    this.astronautGroup.add(rg);

    // Legs — slightly splayed for zero-g
    const legGeo = new THREE.CylinderGeometry(0.028, 0.024, 0.16, 8);
    const leftLeg = new THREE.Mesh(legGeo, suitMat);
    leftLeg.position.set(-0.04, -0.15, 0);
    leftLeg.rotation.set(0.25, 0, 0.15);
    this.astronautGroup.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, suitMat);
    rightLeg.position.set(0.04, -0.15, 0);
    rightLeg.rotation.set(-0.15, 0, -0.1);
    this.astronautGroup.add(rightLeg);

    // Boots
    const bootGeo = new THREE.BoxGeometry(0.035, 0.025, 0.05);
    const bootMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.7 });
    const lb = new THREE.Mesh(bootGeo, bootMat);
    lb.position.set(-0.05, -0.24, 0.015);
    this.astronautGroup.add(lb);
    const rb = new THREE.Mesh(bootGeo, bootMat);
    rb.position.set(0.03, -0.24, -0.01);
    this.astronautGroup.add(rb);

    // US flag patch on left arm
    const flagC = document.createElement('canvas');
    flagC.width = 32; flagC.height = 20;
    const fc = flagC.getContext('2d')!;
    for (let i = 0; i < 13; i++) {
      fc.fillStyle = i % 2 === 0 ? '#BF0A30' : '#FFFFFF';
      fc.fillRect(0, i * (20 / 13), 32, 20 / 13);
    }
    fc.fillStyle = '#002868'; fc.fillRect(0, 0, 12, 10);
    const flagTex = new THREE.CanvasTexture(flagC);
    flagTex.generateMipmaps = false;
    flagTex.minFilter = THREE.LinearFilter;
    const flagPatch = new THREE.Mesh(
      new THREE.PlaneGeometry(0.025, 0.016),
      new THREE.MeshStandardMaterial({ map: flagTex, roughness: 0.8 }),
    );
    flagPatch.position.set(-0.074, 0.02, 0.04);
    flagPatch.rotation.set(0, -0.6, 0.8);
    this.astronautGroup.add(flagPatch);

    // Orange mission stripe
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.008, 0.105),
      new THREE.MeshStandardMaterial({ color: 0xcc4400, roughness: 0.5 }),
    );
    stripe.position.set(0, -0.04, 0);
    this.astronautGroup.add(stripe);

    this.astronautGroup.scale.setScalar(0.6);
    this.astronautGroup.visible = false;
    this.scene.add(this.astronautGroup);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FALLEN ASTRONAUT MEMORIAL — plaque + reclining figure, inspired by the
  // real "Fallen Astronaut" sculpture left on the Moon by Apollo 15
  // ═══════════════════════════════════════════════════════════════════════════
  private createFallenAstronautMemorial() {
    this.fallenAstronautGroup = new THREE.Group();

    // Memorial plaque — brushed aluminum
    const plaqueCanvas = document.createElement('canvas');
    plaqueCanvas.width = 512; plaqueCanvas.height = 340;
    const pc = plaqueCanvas.getContext('2d')!;

    // Brushed-metal background
    const grad = pc.createLinearGradient(0, 0, 512, 340);
    grad.addColorStop(0, '#888888');
    grad.addColorStop(0.5, '#aaaaaa');
    grad.addColorStop(1, '#999999');
    pc.fillStyle = grad;
    pc.fillRect(0, 0, 512, 340);

    // Brushed texture
    pc.globalAlpha = 0.03;
    for (let i = 0; i < 200; i++) {
      pc.strokeStyle = Math.random() > 0.5 ? '#ffffff' : '#666666';
      pc.beginPath();
      pc.moveTo(0, Math.random() * 340);
      pc.lineTo(512, Math.random() * 340);
      pc.stroke();
    }
    pc.globalAlpha = 1.0;

    // Border
    pc.strokeStyle = '#666666';
    pc.lineWidth = 3;
    pc.strokeRect(10, 10, 492, 320);

    // Title
    pc.fillStyle = '#222222';
    pc.font = 'bold 22px sans-serif';
    pc.textAlign = 'center';
    pc.fillText('IN MEMORY', 256, 45);

    // Crew names
    pc.font = '14px sans-serif';
    const names = [
      'STS-107 Columbia (2003)',
      'Rick Husband \u2022 William McCool',
      'Michael Anderson \u2022 David Brown',
      'Kalpana Chawla \u2022 Laurel Clark',
      'Ilan Ramon',
      '',
      'STS-51-L Challenger (1986)',
      'Francis Scobee \u2022 Michael Smith',
      'Judith Resnik \u2022 Ellison Onizuka',
      'Ronald McNair \u2022 Gregory Jarvis',
      'Christa McAuliffe',
    ];
    let ny = 75;
    for (const n of names) {
      pc.font = n.startsWith('STS') ? 'bold 14px sans-serif' : '13px sans-serif';
      pc.fillStyle = n.startsWith('STS') ? '#333333' : '#444444';
      pc.fillText(n, 256, ny);
      ny += n === '' ? 10 : 18;
    }

    // Footer
    pc.font = 'italic 11px sans-serif';
    pc.fillStyle = '#555555';
    pc.fillText('"Ad astra per aspera \u2014 through hardships to the stars"', 256, 310);

    const plaqueTex = new THREE.CanvasTexture(plaqueCanvas);
    plaqueTex.generateMipmaps = false;
    plaqueTex.minFilter = THREE.LinearFilter;
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.8),
      new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.3, metalness: 0.7 }),
    );
    this.fallenAstronautGroup.add(plaque);

    // Reclining figure (inspired by the real "Fallen Astronaut" on the Moon)
    const figMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.08, 4, 8), figMat);
    body.rotation.z = Math.PI / 2;
    body.position.set(0, -0.36, 0.05);
    this.fallenAstronautGroup.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), figMat);
    head.position.set(-0.055, -0.36, 0.05);
    this.fallenAstronautGroup.add(head);

    // Warm reverence light
    const memLight = new THREE.PointLight(0xffeedd, 0.5, 8);
    memLight.position.set(0, 0, 2);
    this.fallenAstronautGroup.add(memLight);

    this.fallenAstronautGroup.position.set(50, 20, -60);
    this.fallenAstronautGroup.lookAt(0, 0, 0);
    this.fallenAstronautGroup.visible = false;
    this.scene.add(this.fallenAstronautGroup);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COLUMBIA STS-107 MEMORIAL — cinematic shuttle re-entry breakup sequence
  // ═══════════════════════════════════════════════════════════════════════════
  private createColumbiaMemorial() {
    this.columbiaGroup = new THREE.Group();

    // ─── Space Shuttle Orbiter — NASA GLB model ────────────────────────
    this.columbiaShuttleMesh = new THREE.Group();
    const loader = new GLTFLoader();
    this.loadPromises.push(new Promise<void>((resolve) => {
      const onModelLoaded = (gltf: { scene: THREE.Group }) => {
        const model = gltf.scene;
        // Normalize to ~4 scene units long (similar to the old procedural shuttle)
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 4 / maxDim;
        model.scale.setScalar(scale);
        const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
        model.position.sub(center);

        // Boost visibility so the shuttle reads against dark space
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (mat.isMeshStandardMaterial) {
              mat.emissive = mat.emissive ?? new THREE.Color(0x000000);
              mat.emissiveIntensity = 0.06;
              mat.emissive.copy(mat.color).multiplyScalar(0.12);
              mat.needsUpdate = true;
            }
          }
        });

        this.columbiaShuttleMesh.add(model);
        resolve();
      };

      const loadFallback = () => {
        loader.load('space_shuttle_columbia.glb', onModelLoaded, undefined, () => {
          // Fallback: simple recognizable shuttle shape if GLB fails
          const fb = new THREE.Mesh(
            new THREE.ConeGeometry(0.5, 4, 8),
            new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 }),
          );
          fb.rotation.z = -Math.PI / 2;
          this.columbiaShuttleMesh.add(fb);
          resolve();
        });
      };

      loader.load('/space_shuttle_columbia.glb', onModelLoaded, undefined, loadFallback);
    }));

    this.columbiaShuttleMesh.scale.setScalar(0.8);
    this.columbiaGroup.add(this.columbiaShuttleMesh);

    // ─── Re-entry plasma trail ──────────────────────────────────────────
    const trailCount = 300;
    const tPos = new Float32Array(trailCount * 3);
    const tSizes = new Float32Array(trailCount);
    const tOffsets = new Float32Array(trailCount);
    for (let i = 0; i < trailCount; i++) {
      tPos[i * 3] = -i * 0.15 + (Math.random() - 0.5) * 0.3;
      tPos[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
      tPos[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      tSizes[i] = 2.0 + Math.random() * 4.0;
      tOffsets[i] = Math.random();
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3));
    trailGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(tSizes, 1));
    trailGeo.setAttribute('aOffset', new THREE.Float32BufferAttribute(tOffsets, 1));

    this.columbiaTrails = new THREE.Points(trailGeo, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
      vertexShader: `
        attribute float aSize;
        attribute float aOffset;
        uniform float uTime;
        varying float vAlpha;
        varying float vHeat;
        void main() {
          vec3 pos = position;
          pos.y += sin(uTime * 3.0 + aOffset * 20.0) * 0.15;
          pos.x += sin(uTime * 2.0 + aOffset * 15.0) * 0.1;
          float dist = length(position.x) / 40.0;
          vAlpha = (1.0 - dist) * 0.8;
          vHeat = 1.0 - dist * 0.7;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = aSize * (150.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uIntensity;
        varying float vAlpha;
        varying float vHeat;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float glow = exp(-d * 4.0);
          vec3 col = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.95, 0.8), vHeat * glow);
          gl_FragColor = vec4(col, glow * vAlpha * uIntensity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.columbiaGroup.add(this.columbiaTrails);

    // ─── Breakup debris (initially invisible) ──────────────────────────
    const debrisCount = 250;
    this.columbiaDebris = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.08, 0),
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 }),
      debrisCount,
    );
    this.columbiaDebrisVelocities = new Float32Array(debrisCount * 3);

    const dm = new THREE.Object3D();
    for (let i = 0; i < debrisCount; i++) {
      dm.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5), (Math.random() - 0.5));
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 2, Math.random() * 1.5 - 0.5, (Math.random() - 0.5) * 2,
      ).normalize().multiplyScalar(0.3 + Math.random() * 1.5);
      this.columbiaDebrisVelocities[i * 3] = v.x;
      this.columbiaDebrisVelocities[i * 3 + 1] = v.y;
      this.columbiaDebrisVelocities[i * 3 + 2] = v.z;
      const s = 0.3 + Math.random() * 1.2;
      dm.scale.set(s, s * (0.3 + Math.random() * 0.7), s);
      dm.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      dm.updateMatrix();
      this.columbiaDebris.setMatrixAt(i, dm.matrix);
      const c = Math.random();
      this.columbiaDebris.setColorAt(i, new THREE.Color(c < 0.33 ? 0xeeeeee : c < 0.66 ? 0x222222 : 0x888899));
    }
    this.columbiaDebris.instanceColor!.needsUpdate = true;
    this.columbiaDebris.visible = false;
    this.columbiaGroup.add(this.columbiaDebris);

    // Flash light for breakup moment
    this.columbiaFlashLight = new THREE.PointLight(0xff8844, 0, 80);
    this.columbiaGroup.add(this.columbiaFlashLight);

    // ─── Seven memorial stars — one per crew member ─────────────────────
    const mPos: number[] = [];
    const mCol: number[] = [];
    const mSz: number[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 1.8;
      mPos.push(Math.sin(a) * 6, 4 + Math.cos(a) * 3, (Math.random() - 0.5) * 0.5);
      mCol.push(0.9, 0.92, 1.0);
      mSz.push(6 + Math.random() * 3);
    }
    const memGeo = new THREE.BufferGeometry();
    memGeo.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
    memGeo.setAttribute('color', new THREE.Float32BufferAttribute(mCol, 3));
    memGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(mSz, 1));
    this.columbiaMemorialStars = new THREE.Points(memGeo, new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: `
        attribute float aSize;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (200.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float core = exp(-d * 3.0);
          float halo = exp(-d * 8.0);
          gl_FragColor = vec4(vColor, (core * 0.7 + halo * 0.3) * uOpacity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.columbiaGroup.add(this.columbiaMemorialStars);

    // Position near Earth — Columbia broke up during re-entry over Earth
    // Earth is at (-8, 2, -5); keep Columbia close so both fit in frame.
    this.columbiaGroup.position.set(-6.2, 3.1, -3.8);
    this.columbiaGroup.visible = false;

    // Dedicated lighting so the shuttle is visible against Earth's glow
    const columbiaKeyLight = new THREE.PointLight(0xfff8e8, 4, 50, 1);
    columbiaKeyLight.position.set(5, 3, 4);
    this.columbiaGroup.add(columbiaKeyLight);
    const columbiaFillLight = new THREE.PointLight(0x88aaff, 1, 30, 1.5);
    columbiaFillLight.position.set(-3, -1, -2);
    this.columbiaGroup.add(columbiaFillLight);

    this.scene.add(this.columbiaGroup);
  }

  private createBlackHole() {
    this.blackHoleGroup = new THREE.Group();

    // 1. Event Horizon — absolute black sphere, no light escapes
    const horizonGeo = new THREE.SphereGeometry(6, 48, 48);
    const horizonMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const eventHorizon = new THREE.Mesh(horizonGeo, horizonMat);
    eventHorizon.renderOrder = -1;
    this.blackHoleGroup.add(eventHorizon);

    // 2. Photon Sphere — thin bright ring at 1.5× Schwarzschild radius
    const photonGeo = new THREE.TorusGeometry(9, 0.15, 32, 256);
    const photonMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal; varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vViewDir;
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 3.0);
          vec3 col = mix(vec3(1.0, 0.85, 0.5), vec3(1.0, 1.0, 1.0), fresnel);
          gl_FragColor = vec4(col * 2.5, fresnel * 0.9);
        }`,
      transparent: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const photonRing = new THREE.Mesh(photonGeo, photonMat);
    photonRing.rotation.x = Math.PI / 2;
    this.blackHoleGroup.add(photonRing);

    // 3. Gravitational Lensing shell — distorts background via refraction
    const lensingGeo = new THREE.SphereGeometry(7.5, 48, 48);
    const lensingMat = new THREE.MeshPhysicalMaterial({
      transmission: 1, opacity: 1, ior: 2.33,
      roughness: 0, thickness: 12, side: THREE.BackSide,
      attenuationColor: new THREE.Color(0.02, 0.01, 0),
      attenuationDistance: 20,
    });
    const lensingSphere = new THREE.Mesh(lensingGeo, lensingMat);
    this.blackHoleGroup.add(lensingSphere);

    // 4. Accretion Disk — Interstellar-style with Doppler beaming, temperature gradient, turbulence
    const diskGeo = new THREE.RingGeometry(8, 28, 256, 64);
    const diskMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash(i); float b = hash(i + vec2(1,0));
          float c = hash(i + vec2(0,1)); float d = hash(i + vec2(1,1));
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
        }

        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5; mat2 rot = mat2(cos(0.5),sin(0.5),-sin(0.5),cos(0.5));
          for(int i = 0; i < 6; i++) {
            v += a * noise(p); p = rot * p * 2.01; a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          float angle = atan(c.y, c.x);

          // Keplerian rotation — inner orbits much faster
          float angularVel = 3.0 / pow(max(r, 0.05), 1.5);
          float spin = angle + uTime * angularVel;

          // Multi-scale turbulence for gaseous structure
          float n1 = fbm(vec2(spin * 3.0, r * 8.0 - uTime * 0.5));
          float n2 = fbm(vec2(spin * 6.0 + 2.3, r * 16.0 - uTime * 0.3));
          float n3 = fbm(vec2(spin * 1.5 - 0.7, r * 4.0 + uTime * 0.2));
          float turb = n1 * 0.6 + n2 * 0.25 + n3 * 0.15;

          // Temperature gradient: white-hot inner → orange → dull red outer
          float temp = smoothstep(1.0, 0.0, r) * 0.8 + turb * 0.2;
          vec3 hotWhite = vec3(1.0, 0.98, 0.95);
          vec3 orange   = vec3(1.0, 0.55, 0.1);
          vec3 deepRed  = vec3(0.6, 0.12, 0.02);
          vec3 col = temp > 0.6 ? mix(orange, hotWhite, (temp - 0.6) / 0.4)
                   : temp > 0.25 ? mix(deepRed, orange, (temp - 0.25) / 0.35)
                   : deepRed * (temp / 0.25);

          // Relativistic Doppler beaming — approaching side boosted, receding dimmed
          float doppler = 1.0 + 0.7 * sin(angle + 0.3);
          // Limb brightening at inner edge (photon pile-up)
          float innerBright = exp(-pow((r - 0.05) * 5.0, 2.0)) * 3.0;

          // Radial density profile: fades at both edges
          float density = smoothstep(0.0, 0.12, r) * smoothstep(1.0, 0.65, r);

          // Ring sub-structure — concentric density waves
          float rings = 0.7 + 0.3 * sin(r * 60.0 + turb * 8.0);

          float intensity = pow(turb, 1.2) * doppler * density * rings + innerBright;

          // HDR emission
          vec3 final = col * intensity * 4.0;

          gl_FragColor = vec4(final, intensity * 0.95);
        }
      `,
      transparent: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    this.accretionDisk = new THREE.Mesh(diskGeo, diskMat);
    this.accretionDisk.rotation.x = Math.PI / 2.15;
    this.accretionDisk.rotation.y = 0.15;
    this.blackHoleGroup.add(this.accretionDisk);

    // 5. Volumetric glow halo — warm ambient light surrounding the disk
    const glowGeo = new THREE.SphereGeometry(30, 32, 32);
    const glowMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal; varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vViewDir;
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 5.0);
          vec3 col = vec3(1.0, 0.45, 0.1) * fresnel * 0.3;
          gl_FragColor = vec4(col, fresnel * 0.15);
        }`,
      transparent: true, side: THREE.BackSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.blackHoleGroup.add(new THREE.Mesh(glowGeo, glowMat));

    // 6. Ambient light from accretion disk — subtle warm illumination
    const diskLight = new THREE.PointLight(0xff7733, 2, 80, 1.5);
    diskLight.position.set(0, 3, 0);
    this.blackHoleGroup.add(diskLight);

    // Position far into deep space, past Pluto
    this.blackHoleGroup.position.set(-350, -50, -400);
    this.scene.add(this.blackHoleGroup);
  }

  private updateBlackHole(time: number) {
    if (!this.blackHoleGroup) return;

    // Update accretion disk shader time
    if (this.accretionDisk) {
      (this.accretionDisk.material as THREE.ShaderMaterial).uniforms['uTime'].value = time;
    }

    // Slow ominous rotation
    this.blackHoleGroup.rotation.y += 0.001;
    this.blackHoleGroup.rotation.z += 0.0005;

    // Cinematic gravity: suck Pluto debris toward the black hole
    if (this.plutoDestroyed && this.plutoDebris) {
      const dummy = new THREE.Object3D();
      const bhPos = this.blackHoleGroup.position;

      for (let i = 0; i < this.plutoDebris.count; i++) {
        this.plutoDebris.getMatrixAt(i, dummy.matrix);
        dummy.position.setFromMatrixPosition(dummy.matrix);

        const pull = new THREE.Vector3().subVectors(bhPos, dummy.position);
        const dist = pull.length();

        if (dist > 2) {
          pull.normalize().multiplyScalar(50 / (dist * dist));
          this.plutoDebrisVelocities[i * 3] += pull.x;
          this.plutoDebrisVelocities[i * 3 + 1] += pull.y;
          this.plutoDebrisVelocities[i * 3 + 2] += pull.z;
        } else {
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          this.plutoDebris.setMatrixAt(i, dummy.matrix);
          this.plutoDebris.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  private createLightsaberDuel() {
    this.lightsaberGroup = new THREE.Group();

    // --- Volumetric blade shader (inner white core + outer colored glow) ---
    const bladeShaderVert = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;
    const bladeShaderFrag = `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
        float core = smoothstep(0.45, 0.0, abs(vUv.x - 0.5));
        float glow = pow(fresnel, 1.5) * 0.8 + core * 1.2;
        vec3 col = mix(vec3(1.0), uColor, fresnel * 0.7) * glow * uIntensity;
        float alpha = clamp(glow * 1.1, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `;

    // Blade geometry — thin capsule
    const bladeGeo = new THREE.CapsuleGeometry(0.03, 1.2, 4, 8);
    // Outer glow — slightly larger
    const glowGeo = new THREE.CapsuleGeometry(0.09, 1.25, 4, 8);

    // Red saber (Sith) — inner blade
    const redBladeMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 0.05, 0) },
        uIntensity: { value: 3 },
      },
      vertexShader: bladeShaderVert,
      fragmentShader: bladeShaderFrag,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.saberRed = new THREE.Mesh(bladeGeo, redBladeMat);

    // Red saber outer glow
    const redGlowMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 0, 0) },
        uIntensity: { value: 1.2 },
      },
      vertexShader: bladeShaderVert,
      fragmentShader: bladeShaderFrag,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.saberGlowRed = new THREE.Mesh(glowGeo, redGlowMat);
    this.saberRed.add(this.saberGlowRed);

    // Green saber (Jedi) — inner blade
    const greenBladeMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0, 1, 0.2) },
        uIntensity: { value: 3 },
      },
      vertexShader: bladeShaderVert,
      fragmentShader: bladeShaderFrag,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.saberGreen = new THREE.Mesh(bladeGeo.clone(), greenBladeMat);

    // Green saber outer glow
    const greenGlowMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0, 1, 0.15) },
        uIntensity: { value: 1.2 },
      },
      vertexShader: bladeShaderVert,
      fragmentShader: bladeShaderFrag,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.saberGlowGreen = new THREE.Mesh(glowGeo.clone(), greenGlowMat);
    this.saberGreen.add(this.saberGlowGreen);

    // Detailed hilts — layered cylinders for a more realistic look
    const hiltMainGeo = new THREE.CylinderGeometry(0.038, 0.042, 0.28, 12);
    const hiltEmitterGeo = new THREE.CylinderGeometry(0.032, 0.036, 0.06, 12);
    const hiltPommelGeo = new THREE.CylinderGeometry(0.044, 0.038, 0.05, 12);
    const hiltGripGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.16, 6);

    const hiltChromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.95, roughness: 0.1 });
    const hiltDarkMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 });
    const hiltGripMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.4, roughness: 0.8 });

    const createHilt = () => {
      const hiltGroup = new THREE.Group();
      hiltGroup.add(new THREE.Mesh(hiltMainGeo, hiltChromeMat));
      const emitter = new THREE.Mesh(hiltEmitterGeo, hiltDarkMat);
      emitter.position.y = 0.17;
      hiltGroup.add(emitter);
      const pommel = new THREE.Mesh(hiltPommelGeo, hiltDarkMat);
      pommel.position.y = -0.165;
      hiltGroup.add(pommel);
      const grip = new THREE.Mesh(hiltGripGeo, hiltGripMat);
      hiltGroup.add(grip);
      return hiltGroup;
    };

    // Sith combatant pivot (blade + hilt attached)
    this.sithPivot = new THREE.Group();
    this.sithPivot.position.set(-0.5, 0, 0);
    const sithHilt = createHilt();
    sithHilt.position.y = -0.75;
    this.sithPivot.add(sithHilt);
    this.sithPivot.add(this.saberRed);
    this.lightsaberGroup.add(this.sithPivot);

    // Jedi combatant pivot
    this.jediPivot = new THREE.Group();
    this.jediPivot.position.set(0.5, 0, 0);
    const jediHilt = createHilt();
    jediHilt.position.y = -0.75;
    this.jediPivot.add(jediHilt);
    this.jediPivot.add(this.saberGreen);
    this.lightsaberGroup.add(this.jediPivot);

    // Dynamic area lights for ambient color bleed
    this.saberLightRed = new THREE.PointLight(0xff2200, 5, 12, 1.5);
    this.saberLightRed.position.copy(this.sithPivot.position);
    this.lightsaberGroup.add(this.saberLightRed);
    this.saberLightGreen = new THREE.PointLight(0x00ff44, 5, 12, 1.5);
    this.saberLightGreen.position.copy(this.jediPivot.position);
    this.lightsaberGroup.add(this.saberLightGreen);

    // Clash spark particle system
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.saberSparkPositions, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    (this as unknown as { saberClashSparks: THREE.Points }).saberClashSparks = new THREE.Points(sparkGeo, sparkMat);
    this.lightsaberGroup.add(this.saberClashSparks);

    // Position the duel arena near Jupiter
    const jp = this.jupiterGroup.position;
    this.lightsaberGroup.position.set(jp.x + 28, jp.y + 3, jp.z + 10);
    this.lightsaberGroup.scale.setScalar(1.8);
    this.lightsaberGroup.visible = false;
    this.scene.add(this.lightsaberGroup);
  }

  private updateLightsaberDuel(time: number) {
    if (!this.lightsaberGroup || !this.sithPivot || !this.jediPivot) return;

    const dt = time - this.saberDuelTimer;
    this.saberDuelTimer = time;
    this.duelMoveElapsed += dt;

    // Advance through choreography sequence
    const move = this.duelMoves[this.duelMoveIndex];
    if (this.duelMoveElapsed >= move.dur) {
      this.duelMoveElapsed -= move.dur;
      this.duelMoveIndex = (this.duelMoveIndex + 1) % this.duelMoves.length;
    }
    const nextMove = this.duelMoves[(this.duelMoveIndex + 1) % this.duelMoves.length];
    const moveT = Math.min(this.duelMoveElapsed / move.dur, 1);
    // Ease in-out for smooth transitions
    const ease = moveT < 0.5 ? 2 * moveT * moveT : 1 - Math.pow(-2 * moveT + 2, 2) / 2;

    // Sith pivot animation
    const sithTargetZ = move.sithZ + (nextMove.sithZ - move.sithZ) * ease;
    const sithTargetX = move.sithX + (nextMove.sithX - move.sithX) * ease;
    this.sithPivot.rotation.z += (sithTargetZ - this.sithPivot.rotation.z) * 0.12;
    this.sithPivot.rotation.x += (sithTargetX - this.sithPivot.rotation.x) * 0.12;
    // Footwork — lateral movement
    this.sithPivot.position.x = -0.5 + Math.sin(time * 1.8) * 0.15;
    this.sithPivot.position.z = Math.sin(time * 1.2) * 0.1;

    // Jedi pivot animation
    const jediTargetZ = move.jediZ + (nextMove.jediZ - move.jediZ) * ease;
    const jediTargetX = move.jediX + (nextMove.jediX - move.jediX) * ease;
    this.jediPivot.rotation.z += (jediTargetZ - this.jediPivot.rotation.z) * 0.12;
    this.jediPivot.rotation.x += (jediTargetX - this.jediPivot.rotation.x) * 0.12;
    this.jediPivot.position.x = 0.5 + Math.sin(time * 1.8 + Math.PI) * 0.15;
    this.jediPivot.position.z = Math.sin(time * 1.2 + 1.5) * 0.1;

    // Blade shimmer — subtle intensity flicker on the shader
    const flicker = 0.92 + Math.random() * 0.16;
    const redMat = this.saberRed.material as THREE.ShaderMaterial;
    const greenMat = this.saberGreen.material as THREE.ShaderMaterial;
    if (redMat.uniforms) redMat.uniforms['uIntensity'].value = 3 * flicker;
    if (greenMat.uniforms) greenMat.uniforms['uIntensity'].value = 3 * flicker;

    // Update light positions (world space from pivots)
    const redWorldPos = new THREE.Vector3();
    this.saberRed.getWorldPosition(redWorldPos);
    this.saberLightRed.position.copy(this.lightsaberGroup.worldToLocal(redWorldPos.clone()));
    const greenWorldPos = new THREE.Vector3();
    this.saberGreen.getWorldPosition(greenWorldPos);
    this.saberLightGreen.position.copy(this.lightsaberGroup.worldToLocal(greenWorldPos.clone()));

    // Clash detection — compare blade tip world positions
    const bladeDist = redWorldPos.distanceTo(greenWorldPos);
    const isClash = move.clash && moveT > 0.3 && moveT < 0.8;

    if (isClash && bladeDist < 1.8) {
      // Bright strobe on clash
      const strobe = 6 + Math.random() * 6;
      this.saberLightRed.intensity = strobe;
      this.saberLightGreen.intensity = strobe;
      // Emit sparks at midpoint
      const mid = redWorldPos.clone().add(greenWorldPos).multiplyScalar(0.5);
      const localMid = this.lightsaberGroup.worldToLocal(mid);
      this.emitSaberSparks(localMid, 8);
    } else {
      this.saberLightRed.intensity = 5;
      this.saberLightGreen.intensity = 5;
    }

    // Update spark particles
    this.updateSaberSparks(dt);

    // Gentle group rotation so the duel is visible from different angles
    this.lightsaberGroup.rotation.y += 0.002;
  }

  private emitSaberSparks(origin: THREE.Vector3, count: number) {
    for (let i = 0; i < count; i++) {
      const idx = this.saberSparkIndex % 60;
      this.saberSparkPositions[idx * 3] = origin.x;
      this.saberSparkPositions[idx * 3 + 1] = origin.y;
      this.saberSparkPositions[idx * 3 + 2] = origin.z;
      this.saberSparkVelocities[idx * 3] = (Math.random() - 0.5) * 4;
      this.saberSparkVelocities[idx * 3 + 1] = (Math.random() - 0.5) * 4;
      this.saberSparkVelocities[idx * 3 + 2] = (Math.random() - 0.5) * 4;
      this.saberSparkLifetimes[idx] = 0.4 + Math.random() * 0.3;
      this.saberSparkIndex++;
    }
  }

  private updateSaberSparks(dt: number) {
    for (let i = 0; i < 60; i++) {
      if (this.saberSparkLifetimes[i] <= 0) continue;
      this.saberSparkLifetimes[i] -= dt;
      this.saberSparkPositions[i * 3] += this.saberSparkVelocities[i * 3] * dt;
      this.saberSparkPositions[i * 3 + 1] += this.saberSparkVelocities[i * 3 + 1] * dt;
      this.saberSparkPositions[i * 3 + 2] += this.saberSparkVelocities[i * 3 + 2] * dt;
      // Gravity on sparks
      this.saberSparkVelocities[i * 3 + 1] -= 6 * dt;
      // Fade dead sparks far away
      if (this.saberSparkLifetimes[i] <= 0) {
        this.saberSparkPositions[i * 3] = 9999;
        this.saberSparkPositions[i * 3 + 1] = 9999;
        this.saberSparkPositions[i * 3 + 2] = 9999;
      }
    }
    if (this.saberClashSparks) {
      (this.saberClashSparks.geometry.attributes['position'] as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  triggerHyperspaceJump() {
    if (this.hyperspaceActive) return;
    this.hyperspaceActive = true;
    this.hyperspaceTimer = 0;
    this.originalFov = this.camera.fov;
  }

  private updateHyperspace(deltaTime: number, time: number) {
    if (!this.hyperspaceActive) return;
    if (this.prefersReducedMotion) return;

    this.hyperspaceTimer += deltaTime;
    const t = this.hyperspaceTimer / this.hyperspaceDuration;
    const caBase = 0.0006;

    this.updateHyperspaceChromaticAberration(t, caBase);
    this.applyHyperspaceCameraShake(t, time);
    this.updateHyperspaceLensAndBloom(t, caBase);
    this.updateHyperspaceStarStretch(t);
  }

  private updateHyperspaceChromaticAberration(t: number, caBase: number) {
    if (t < 0.2) {
      const caT = t / 0.2;
      this.postProcessManager?.setChromaticAberrationOffset(
        THREE.MathUtils.lerp(caBase, 0.012, caT),
        THREE.MathUtils.lerp(caBase, 0.008, caT),
      );
      return;
    }

    if (t < 0.8) {
      this.postProcessManager?.setChromaticAberrationOffset(0.012, 0.008);
      return;
    }

    if (t < 1) {
      const snapT = (t - 0.8) / 0.2;
      this.postProcessManager?.setChromaticAberrationOffset(
        THREE.MathUtils.lerp(0.012, caBase, snapT),
        THREE.MathUtils.lerp(0.008, caBase, snapT),
      );
    }
  }

  private applyHyperspaceCameraShake(t: number, time: number) {
    if (t <= 0.1 || t >= 0.85) {
      return;
    }

    const shakeIntensity = t < 0.3 ? 0.04 : 0.015;
    const warpT = (time - this.falconLaunchTime) * 18;
    this.camera.position.x += Math.sin(warpT) * shakeIntensity;
    this.camera.position.y += Math.cos(warpT * 1.4) * shakeIntensity * 0.6;
  }

  private updateHyperspaceLensAndBloom(t: number, caBase: number) {
    if (t < 0.2) {
      this.camera.fov = THREE.MathUtils.lerp(this.originalFov, 120, t / 0.2);
      this.camera.updateProjectionMatrix();
      return;
    }

    if (t < 0.3) {
      this.camera.fov = 120;
      this.camera.updateProjectionMatrix();
      this.postProcessManager?.setBloomIntensity(10);
      return;
    }

    if (t < 0.8) {
      const fadeT = (t - 0.3) / 0.5;
      this.camera.fov = 120;
      this.camera.updateProjectionMatrix();
      this.postProcessManager?.setBloomIntensity(THREE.MathUtils.lerp(10, this.originalBloomIntensity, fadeT));
      return;
    }

    if (t < 1) {
      const snapT = (t - 0.8) / 0.2;
      this.camera.fov = THREE.MathUtils.lerp(120, this.originalFov, snapT);
      this.camera.updateProjectionMatrix();
      this.postProcessManager?.setBloomIntensity(this.originalBloomIntensity);
      return;
    }

    this.camera.fov = this.originalFov;
    this.camera.updateProjectionMatrix();
    this.postProcessManager?.setBloomIntensity(this.originalBloomIntensity);
    this.postProcessManager?.setChromaticAberrationOffset(caBase, caBase);
    this.hyperspaceActive = false;
  }

  private updateHyperspaceStarStretch(t: number) {
    if (!this.stars) {
      return;
    }

    if (t < 0.8) {
      const stretch = t < 0.2 ? t / 0.2 : 1;
      this.stars.scale.set(1, 1, 1 + stretch * 20);
      return;
    }

    const snapT = Math.min((t - 0.8) / 0.2, 1);
    this.stars.scale.set(1, 1, THREE.MathUtils.lerp(21, 1, snapT));
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
        const trailGeo = new THREE.CylinderGeometry(0.003, 0.04, 1, 6);
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
    const hullMat = new THREE.MeshStandardMaterial({ color: imperialGrey, metalness: 0.8, roughness: 0.15, emissive: 0x111122, emissiveIntensity: 0.15 });
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
          new THREE.BoxGeometry(0.02, 1, 0.015),
          frameMat
        );
        gridV.position.set(side * 0.6, i * 0.2, 0);
        group.add(gridV);
      }
      for (let i = -2; i <= 2; i++) {
        const gridH = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.015, 1),
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
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1, 6), hullMat);
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
        side, -0.8, 0.5,            // tip
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
      glow.position.set(side * 0.18, -0.18, 1);
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

      // Pure math orbital position (no physics engine needed)
      ship.group.position.set(
        jupiterPos.x + ship.orbitRadius * cosA,
        jupiterPos.y + ship.orbitY + ship.orbitRadius * sinA * sinI,
        jupiterPos.z + ship.orbitRadius * sinA * cosI
      );

      // Look ahead along orbit path
      const ahead = ship.orbitAngle + Math.sign(ship.orbitSpeed) * 0.1;
      ship.group.lookAt(
        jupiterPos.x + ship.orbitRadius * Math.cos(ahead),
        jupiterPos.y + ship.orbitY + ship.orbitRadius * Math.sin(ahead) * sinI,
        jupiterPos.z + ship.orbitRadius * Math.sin(ahead) * cosI
      );

      // Update ribbon trail
      if (ship.trail) {
        // Shift history forward
        const posArr = ship.trail.geometry.attributes['position'] as THREE.BufferAttribute;
        for (let i = ship.trailLength - 1; i > 0; i--) {
          posArr.setXYZ(i,
            posArr.getX(i - 1),
            posArr.getY(i - 1),
            posArr.getZ(i - 1)
          );
        }
        posArr.setXYZ(0, ship.group.position.x, ship.group.position.y, ship.group.position.z);
        posArr.needsUpdate = true;
      }
    });
  }

  private createGalaxyEffects() {
    this.createMilkyWayBand();
    this.createDistantGalaxies();
    this.createCosmicDustClouds();
  }

  private createMilkyWayBand() {
    // Milky Way band — dense galactic-plane stars with varied depth and color
    // Reduced from 55,000 for CPU performance
    const bandCount = 8000;
    const bandGeo = new THREE.BufferGeometry();
    const bandPos = new Float32Array(bandCount * 3);
    const bandColors = new Float32Array(bandCount * 3);
    const bandSizes = new Float32Array(bandCount);

    for (let i = 0; i < bandCount; i++) {
      const i3 = i * 3;
      const r = 80 + Math.pow(Math.random(), 0.4) * 800;
      const theta = Math.random() * Math.PI * 2;
      // Exponential thickness falloff for realistic thin-disk appearance
      const thickness = (Math.random() - 0.5) * 25 * Math.exp(-Math.random() * 3.5);

      const x = r * Math.cos(theta);
      const y = thickness;
      const z = r * Math.sin(theta);

      // Tilt 25° and shift back
      const cosT = 0.906;
      const sinT = 0.423;
      bandPos[i3] = x;
      bandPos[i3 + 1] = y * cosT - z * sinT + 60;
      bandPos[i3 + 2] = y * sinT + z * cosT - 300;

      // Richer spectral color variation
      const b = 0.35 + Math.random() * 0.65;
      const colorRoll = Math.random();
      if (colorRoll < 0.3) {
        // Warm white-yellow (G/K type)
        bandColors[i3] = b; bandColors[i3 + 1] = b * 0.92; bandColors[i3 + 2] = b * 0.78;
      } else if (colorRoll < 0.55) {
        // Cool blue-white (B/A type)
        bandColors[i3] = b * 0.8; bandColors[i3 + 1] = b * 0.88; bandColors[i3 + 2] = b;
      } else if (colorRoll < 0.75) {
        // Faint reddish (M type — most common)
        bandColors[i3] = b * 0.95; bandColors[i3 + 1] = b * 0.7; bandColors[i3 + 2] = b * 0.6;
      } else if (colorRoll < 0.9) {
        // Pure white
        bandColors[i3] = b; bandColors[i3 + 1] = b; bandColors[i3 + 2] = b * 0.97;
      } else {
        // Nebula-tinted (pinkish/bluish)
        bandColors[i3] = b * 0.9; bandColors[i3 + 1] = b * 0.75; bandColors[i3 + 2] = b;
      }
      bandSizes[i] = Math.random() < 0.97 ? Math.random() * 1.2 + 0.2 : Math.random() * 3 + 1.5;
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
        varying float vBrightness;
        uniform float uTime;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float phase = position.x * 0.037 + position.z * 0.051;
          float twinkle = 0.82 + 0.18 * sin(uTime * 1.2 + phase);
          vBrightness = twinkle;
          gl_PointSize = aSize * twinkle * (220.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vBrightness;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float dist = length(uv);
          if (dist > 0.5) discard;
          // Soft Gaussian core + gentle halo
          float core = exp(-dist * dist * 200.0);
          float glow = exp(-dist * 7.0) * 0.35;
          float alpha = (core + glow) * 0.55 * vBrightness;
          vec3 c = mix(vColor, vec3(1.0), core * 0.5);
          gl_FragColor = vec4(c, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.galaxyBand = new THREE.Points(bandGeo, bandMat);
    this.scene.add(this.galaxyBand);
  }

  private createDistantGalaxies() {
    // Distant galaxy sprites — more count, varied color, hint of spiral structure
    const galaxyCount = 80;
    const gGeo = new THREE.BufferGeometry();
    const gPos = new Float32Array(galaxyCount * 3);
    const gSizes = new Float32Array(galaxyCount);
    const gColors = new Float32Array(galaxyCount * 3);
    for (let i = 0; i < galaxyCount; i++) {
      gPos[i * 3] = (Math.random() - 0.5) * 2000;
      gPos[i * 3 + 1] = (Math.random() - 0.5) * 900 + 50;
      gPos[i * 3 + 2] = -200 - Math.random() * 1000;
      gSizes[i] = 2.5 + Math.random() * 6;
      const gc = Math.random();
      if (gc < 0.35) {
        gColors[i*3] = 0.7; gColors[i*3+1] = 0.55; gColors[i*3+2] = 0.9; // lavender
      } else if (gc < 0.65) {
        gColors[i*3] = 1; gColors[i*3+1] = 0.9; gColors[i*3+2] = 0.75; // warm gold
      } else {
        gColors[i*3] = 0.6; gColors[i*3+1] = 0.75; gColors[i*3+2] = 1; // blue-white
      }
    }
    gGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
    gGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(gSizes, 1));
    gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gColors, 3));

    this.scene.add(new THREE.Points(gGeo, new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aSize;
        attribute vec3 color;
        varying vec3 vGColor;
        void main() {
          vGColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (400.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vGColor;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          // Elliptical + hint of spiral
          float angle = atan(c.y, c.x);
          float spiral = sin(angle * 2.0 + d * 12.0) * 0.15 * (1.0 - d * 2.0);
          float glow = exp(-d * 6.5) * 0.6 + spiral * 0.12;
          float core = exp(-d * 20.0);
          vec3 col = mix(vGColor, vec3(1.0, 0.98, 0.92), core);
          gl_FragColor = vec4(col, clamp((glow + core * 0.4) * 0.35, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })));
  }

  private createCosmicDustClouds() {
    // Volumetric cosmic dust clouds — denser, more color variety
    const cDustCount = 5000;
    const cGeo = new THREE.BufferGeometry();
    const cPos = new Float32Array(cDustCount * 3);
    const cColors = new Float32Array(cDustCount * 3);
    for (let i = 0; i < cDustCount; i++) {
      cPos[i * 3] = (Math.random() - 0.5) * 400;
      cPos[i * 3 + 1] = (Math.random() - 0.5) * 400;
      cPos[i * 3 + 2] = (Math.random() - 0.5) * 400;
      const roll = Math.random();
      if (roll < 0.25) {
        cColors[i * 3] = 0.3; cColors[i * 3 + 1] = 0.2; cColors[i * 3 + 2] = 0.55;
      } else if (roll < 0.5) {
        cColors[i * 3] = 0.2; cColors[i * 3 + 1] = 0.3; cColors[i * 3 + 2] = 0.5;
      } else if (roll < 0.75) {
        cColors[i * 3] = 0.45; cColors[i * 3 + 1] = 0.22; cColors[i * 3 + 2] = 0.2;
      } else {
        cColors[i * 3] = 0.35; cColors[i * 3 + 1] = 0.15; cColors[i * 3 + 2] = 0.4;
      }
    }
    cGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
    cGeo.setAttribute('color', new THREE.Float32BufferAttribute(cColors, 3));
    this.scene.add(new THREE.Points(cGeo, new THREE.PointsMaterial({
      size: 0.5, transparent: true, opacity: 0.14, vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    })));
  }

  private createStarClusters() {
    const clusterCount = 3500;
    const clusterGeo = new THREE.IcosahedronGeometry(0.18, 0);
    const clusterMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.starClusters = new THREE.InstancedMesh(clusterGeo, clusterMat, clusterCount);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < clusterCount; i++) {
      const radius = 180 + Math.random() * 1400;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
      dummy.position.setFromSphericalCoords(radius, phi, theta);
      const scale = 0.5 + Math.random() * 2.5;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      this.starClusters.setMatrixAt(i, dummy.matrix);
      // Wider spectral range: blue-white to warm gold to faint rose
      const hue = Math.random() < 0.7 ? 0.06 + Math.random() * 0.16 : 0.55 + Math.random() * 0.12;
      const sat = 0.2 + Math.random() * 0.4;
      const lum = 0.65 + Math.random() * 0.25;
      this.starClusters.setColorAt(i, new THREE.Color().setHSL(hue, sat, lum));
    }

    this.starClusters.instanceMatrix.needsUpdate = true;
    if (this.starClusters.instanceColor) {
      this.starClusters.instanceColor.needsUpdate = true;
    }

    this.scene.add(this.starClusters);
  }

  private bootstrapManagers() {
    this.postProcessManager = new PostProcessManager(this.renderer, this.scene, this.camera, this.sunMesh);
    this.registerBloomTargets();
    this.registerPhysicsBodies();
    this.registerFrustumTargets();
  }

  private registerBloomTargets() {
    // Bloom is now luminance-threshold based (objects with color > 1.0 glow automatically).
    // No per-object selection needed — this eliminates an entire extra render pass.
  }

  private registerPhysicsBodies() {
    this.physicsManager.bridge(this.jupiterGroup, { kind: 'fixed', collider: 'ball', radius: 10 });
    this.physicsManager.bridge(this.sunMesh, { kind: 'fixed', collider: 'ball', radius: 6 });
    this.physicsManager.bridge(this.earthMesh, { kind: 'kinematic', collider: 'ball', radius: 0.89 });
    this.physicsManager.bridge(this.moonMesh, { kind: 'kinematic', collider: 'ball', radius: 0.28 });
    this.physicsManager.bridge(this.marsMesh, { kind: 'fixed', collider: 'ball', radius: 0.475 });
    this.physicsManager.bridge(this.saturnGroup, { kind: 'fixed', collider: 'ball', radius: 8.4 });
    this.physicsManager.bridge(this.uranusGroup, { kind: 'fixed', collider: 'ball', radius: 3.6 });
    this.physicsManager.bridge(this.neptuneGroup, { kind: 'fixed', collider: 'ball', radius: 3.5 });
    this.physicsManager.bridge(this.titanMesh, { kind: 'kinematic', collider: 'ball', radius: 0.5 });
    this.physicsManager.bridge(this.plutoMesh, { kind: 'fixed', collider: 'ball', radius: 0.32 });
    this.physicsManager.bridge(this.falconGroup, {
      kind: 'dynamic',
      collider: 'capsule',
      radius: 0.05,
      halfHeight: 0.22,
      mass: 0.4,
      linearDamping: 0.06,
      angularDamping: 0.25,
      ccd: true,
      canSleep: false,
    });

    this.spaceshipData.forEach((ship) => {
      ship.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
        }
      });
    });
  }

  private registerFrustumTargets() {
    this.frustumCullTargets.length = 0;
    this.frustumCullTargets.push(
      { object: this.saturnGroup, radius: 30 },
      { object: this.uranusGroup, radius: 18 },
      { object: this.neptuneGroup, radius: 18 },
      { object: this.plutoMesh, radius: 8 },
      { object: this.asteroidBelt, radius: 55 },
      { object: this.trojanL4, radius: 28 },
      { object: this.trojanL5, radius: 28 },
      { object: this.starClusters, radius: 1500 },
      { object: this.deathStarGroup, radius: 12 },
      { object: this.asbjornStormGroup, radius: 30 },
      { object: this.crossConstellation, radius: 20 },
    );
  }

  private updateCustomFrustumCulling() {
    this.projectionMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionMatrix);

    for (const target of this.frustumCullTargets) {
      if (!target.object) continue;
      // Don't override visibility of destroyed Pluto
      if (target.object === this.plutoMesh && this.plutoDestroyed) continue;
      // Easter-egg objects only visible when tour is active
      if (!this.tourActive && (
        target.object === this.asbjornStormGroup ||
        target.object === this.crossConstellation ||
        target.object === this.deathStarGroup
      )) {
        target.object.visible = false;
        continue;
      }
      this.tempSphere.set(target.object.position, target.radius);
      target.object.visible = this.frustum.intersectsSphere(this.tempSphere);
    }
  }

  private getGravitySources() {
    return [
      { position: this.jupiterGroup.position, mass: 120_000 },
      { position: this.sunMesh.position, mass: 240_000 },
      { position: this.earthMesh.position, mass: 3_000 },
      { position: this.marsMesh.position, mass: 1_800 },
    ];
  }

  private maybeShiftFloatingOrigin() {
    const playerPosition = this.physicsManager.getPlayerPosition();
    if (!playerPosition || playerPosition.length() < this.floatingOriginThreshold) {
      return;
    }

    const shift = playerPosition.clone();
    this.scene.children.forEach((child) => {
      child.position.sub(shift);
    });
    this.physicsManager.shiftWorld(shift);

    this.camera.position.sub(shift);
    this.currentLookAt.sub(shift);
    this.targetLookAt.sub(shift);
    this.baseCameraX -= shift.x;
    this.baseCameraY -= shift.y;
    this.baseCameraZ -= shift.z;
    this.targetCameraX -= shift.x;
    this.targetCameraY -= shift.y;
    this.targetCameraZ -= shift.z;
    this.controls.target.sub(shift);
    this.falconStartPos.sub(shift);
    this.falconTargetPos.sub(shift);
  }

  private buildFalcon9(): THREE.Group {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3, metalness: 0.4 });
    const interMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3 });
    const engMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.8 });

    const exhaustVert = `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
    const exhaustFrag = `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float dist = length(vUv - vec2(0.5, 0.0));
        float core = smoothstep(0.5, 0.0, dist);
        vec3 col = mix(vec3(1.0,0.3,0.05), vec3(1.0,0.95,0.8), core*core);
        float flicker = 0.85 + 0.15*sin(uTime*30.0 + vUv.y*20.0);
        float alpha = core * flicker * smoothstep(1.0, 0.0, vUv.y);
        gl_FragColor = vec4(col, alpha*0.9);
      }`;

    // === FIRST STAGE SUB-GROUP ===
    this.falconFirstStage = new THREE.Group();

    const s1Body = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.32, 12), bodyMat);
    s1Body.position.y = 0.16;
    this.falconFirstStage.add(s1Body);

    // Grid fins (4)
    const finMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.003), finMat);
      const angle = (i * Math.PI) / 2;
      fin.position.set(Math.cos(angle) * 0.03, 0.28, Math.sin(angle) * 0.03);
      fin.rotation.y = angle;
      this.falconFirstStage.add(fin);
    }

    // Interstage
    const interstage = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), interMat);
    interstage.position.y = 0.335;
    this.falconFirstStage.add(interstage);

    // SpaceX logo strip
    const logoStrip = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.02, 12), interMat);
    logoStrip.position.y = 0.12;
    this.falconFirstStage.add(logoStrip);

    // Landing legs (4)
    const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7, metalness: 0.5 });
    this.falconLegs = [];
    for (let i = 0; i < 4; i++) {
      const legGroup = new THREE.Group();
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.06, 0.015), legMat);
      leg.position.set(0, -0.03, 0);
      legGroup.add(leg);
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      legGroup.position.set(Math.cos(angle) * 0.03, 0.04, Math.sin(angle) * 0.03);
      legGroup.rotation.y = angle;
      legGroup.rotation.x = 0;
      this.falconLegs.push(legGroup);
      this.falconFirstStage.add(legGroup);
    }

    // Merlin engines (9 at base — 1 center + 8 octaweb)
    for (let i = 0; i < 9; i++) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.015, 8), engMat);
      if (i === 0) {
        eng.position.set(0, -0.005, 0);
      } else {
        const angle = ((i - 1) * Math.PI * 2) / 8;
        eng.position.set(Math.cos(angle) * 0.016, -0.005, Math.sin(angle) * 0.016);
      }
      this.falconFirstStage.add(eng);
    }

    // First stage exhaust (9 Merlins — large plume)
    const s1ExhaustMat = new THREE.ShaderMaterial({
      vertexShader: exhaustVert, fragmentShader: exhaustFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.falconExhaust = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.25, 12, 1, true), s1ExhaustMat);
    this.falconExhaust.position.y = -0.14;
    this.falconExhaust.rotation.x = Math.PI;
    this.falconExhaust.visible = false;
    this.falconFirstStage.add(this.falconExhaust);
    const s1Light = new THREE.PointLight(0xff6622, 0, 3, 2);
    s1Light.name = 'exhaustLight';
    this.falconExhaust.add(s1Light);

    group.add(this.falconFirstStage);

    // === SECOND STAGE SUB-GROUP ===
    this.falconSecondStage = new THREE.Group();

    const s2Body = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.025, 0.12, 12), bodyMat);
    s2Body.position.y = 0.41;
    this.falconSecondStage.add(s2Body);

    // MVac engine
    const mvac = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.02, 8), engMat);
    mvac.position.y = 0.34;
    this.falconSecondStage.add(mvac);

    // Second stage exhaust (single MVac — smaller, bluer plume)
    const s2ExhaustMat = new THREE.ShaderMaterial({
      vertexShader: exhaustVert, fragmentShader: exhaustFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.falconSecondExhaust = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.18, 12, 1, true), s2ExhaustMat);
    this.falconSecondExhaust.position.y = 0.24;
    this.falconSecondExhaust.rotation.x = Math.PI;
    this.falconSecondExhaust.visible = false;
    this.falconSecondStage.add(this.falconSecondExhaust);
    const s2Light = new THREE.PointLight(0x4488ff, 0, 2, 2);
    s2Light.name = 'exhaustLight2';
    this.falconSecondExhaust.add(s2Light);

    // Payload fairing — two halves (will jettison separately)
    const fairingMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.25, metalness: 0.3 });
    this.falconFairingL = new THREE.Mesh(
      new THREE.CylinderGeometry(0, 0.026, 0.07, 12, 1, false, 0, Math.PI), fairingMat
    );
    this.falconFairingL.position.y = 0.505;
    this.falconSecondStage.add(this.falconFairingL);

    this.falconFairingR = new THREE.Mesh(
      new THREE.CylinderGeometry(0, 0.026, 0.07, 12, 1, false, Math.PI, Math.PI), fairingMat
    );
    this.falconFairingR.position.y = 0.505;
    this.falconSecondStage.add(this.falconFairingR);

    // Dragon capsule (revealed after fairing jettison)
    const capsule = new THREE.Mesh(
      new THREE.ConeGeometry(0.018, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.35, metalness: 0.3 })
    );
    capsule.position.y = 0.49;
    this.falconSecondStage.add(capsule);

    // Trunk section
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.2 })
    );
    trunk.position.y = 0.465;
    this.falconSecondStage.add(trunk);

    group.add(this.falconSecondStage);

    group.visible = false;
    return group;
  }

  private launchFalcon9() {
    if (!this.falconGroup || !this.earthMesh || !this.marsMesh) return;

    // Re-attach first stage if previously separated
    if (this.falconSeparated && this.falconFirstStage.parent !== this.falconGroup) {
      this.scene.remove(this.falconFirstStage);
      this.falconGroup.add(this.falconFirstStage);
      this.falconFirstStage.position.set(0, 0, 0);
      this.falconFirstStage.quaternion.identity();
    }
    // Re-attach fairings
    if (this.falconFairingsJettisoned) {
      if (this.falconFairingL.parent === this.scene) this.scene.remove(this.falconFairingL);
      if (this.falconFairingR.parent === this.scene) this.scene.remove(this.falconFairingR);
      this.falconSecondStage.add(this.falconFairingL);
      this.falconSecondStage.add(this.falconFairingR);
      this.falconFairingL.position.y = 0.505;
      this.falconFairingR.position.y = 0.505;
      this.falconFairingL.quaternion.identity();
      this.falconFairingR.quaternion.identity();
      this.falconFairingL.visible = true;
      this.falconFairingR.visible = true;
    }

    this.falconSeparated = false;
    this.falconFairingsJettisoned = false;

    const earthPos = this.earthMesh.position;
    this.falconGroup.position.set(earthPos.x + 0.5, earthPos.y + 0.9, earthPos.z + 0.5);
    this.falconGroup.visible = true;
    this.falconExhaust.visible = true;
    this.falconSecondExhaust.visible = false;
    this.falconLaunched = true;
    this.falconHyperspaceTriggered = false;
    this.falconLaunchTime = (Date.now() - this.startTime) * 0.001;
    this.falconGroup.scale.setScalar(2.5);
    this.falconStartPos.copy(this.falconGroup.position);
    // Land ON Mars surface — normalize offset direction and place at surface radius + tiny clearance
    const marsRadius = 0.475;
    const landDir = new THREE.Vector3(0.42, 0.58, 0.38).normalize();
    this.falconTargetPos.copy(this.marsMesh.position).addScaledVector(landDir, marsRadius + 0.02);
    this.physicsManager.setTranslation(this.falconGroup, this.falconStartPos, true);
    this.physicsManager.setLinvel(this.falconGroup, new THREE.Vector3(), true);
    this.physicsManager.applyImpulse(this.falconGroup, new THREE.Vector3(0, 1.8, 0.4), true);
    const light = this.falconExhaust.getObjectByName('exhaustLight') as THREE.PointLight;
    if (light) light.intensity = 4;
  }

  private getFalconCruiseMidpoint(): THREE.Vector3 {
    const midpoint = new THREE.Vector3().lerpVectors(this.falconStartPos, this.falconTargetPos, 0.18);
    midpoint.y += 8;
    return midpoint;
  }

  private getFalconApproachPosition(): THREE.Vector3 {
    return this.falconTargetPos.clone().add(new THREE.Vector3(0, 2.3, 0));
  }

  private getFalconFlightTarget(t: number): THREE.Vector3 {
    if (t < 0.1) {
      const liftT = t / 0.1;
      const liftEase = liftT * liftT;
      return new THREE.Vector3().lerpVectors(
        this.falconStartPos,
        new THREE.Vector3(this.falconStartPos.x, this.falconStartPos.y + 3.4, this.falconStartPos.z),
        liftEase
      );
    }

    if (t < 0.24) {
      const turnT = (t - 0.1) / 0.14;
      const above = new THREE.Vector3(this.falconStartPos.x, this.falconStartPos.y + 3.4, this.falconStartPos.z);
      return new THREE.Vector3().lerpVectors(above, this.getFalconCruiseMidpoint(), turnT);
    }

    if (t < 0.82) {
      const cruiseT = (t - 0.24) / 0.58;
      const cruiseEase = 1 - Math.pow(1 - cruiseT, 2);
      const scale = Math.max(0.9, 2.5 - cruiseT * 1.5);
      this.falconGroup.scale.setScalar(scale);
      return new THREE.Vector3().lerpVectors(this.getFalconCruiseMidpoint(), this.getFalconApproachPosition(), cruiseEase);
    }

    const landingT = (t - 0.82) / 0.18;
    const landingEase = 1 - Math.pow(1 - landingT, 3);
    const landingScale = Math.max(0.8, 1 - landingT * 0.15);
    this.falconGroup.scale.setScalar(landingScale);
    return new THREE.Vector3().lerpVectors(this.getFalconApproachPosition(), this.falconTargetPos, landingEase);
  }


  private finalizeFalconLanding() {
    this.falconExhaust.visible = false;
    this.falconSecondExhaust.visible = false;
    this.physicsManager.setTranslation(this.falconGroup, this.falconTargetPos, true);
    this.physicsManager.setLinvel(this.falconGroup, new THREE.Vector3(), true);
    this.falconGroup.quaternion.slerp(new THREE.Quaternion(), 1);
    this.falconGroup.visible = true;
    this.falconLaunched = false;
    // Hide separated first stage (it "landed" back on Earth off-camera)
    if (this.falconFirstStage.parent === this.scene) {
      this.falconFirstStage.visible = false;
    }
    // Hide jettisoned fairings
    if (this.falconFairingL.parent === this.scene) this.falconFairingL.visible = false;
    if (this.falconFairingR.parent === this.scene) this.falconFairingR.visible = false;
    // Exhaust lights off
    const light = this.falconExhaust.getObjectByName('exhaustLight') as THREE.PointLight;
    if (light) light.intensity = 0;
    const light2 = this.falconSecondExhaust.getObjectByName('exhaustLight2') as THREE.PointLight;
    if (light2) light2.intensity = 0;
    // Clear telemetry HUD
    this.ngZone.run(() => this.telemetry.emit(null));
    // Skip ahead in tour — don't return to Earth, jump to the stop after Mars
    const marsIdx = this.tourStops.findIndex(s => s.name === 'mars');
    if (marsIdx >= 0 && marsIdx + 1 < this.tourStops.length) {
      this.tourStopIndex = marsIdx + 1;
      this.activeCameraAnchorKey = this.tourStops[this.tourStopIndex].name;
      this.transitionTheatreCameraToKey(this.tourStops[this.tourStopIndex].name);
      this.tourPlanet.emit(this.tourStops[this.tourStopIndex].name);
    }
    this.tourStopTime = (Date.now() - this.startTime) * 0.001;
  }

  private createStarman() {
    this.starmanGroup = new THREE.Group();
    const loader = new GLTFLoader();
    this.loadPromises.push(new Promise<void>((resolve) => {
      const onModelLoaded = (gltf: { scene: THREE.Group }) => {
        const model = gltf.scene;
        // Scale to a visible car-sized object (~0.8 scene units long)
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 0.8 / maxDim;
        model.scale.setScalar(scale);
        const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
        model.position.sub(center);

        // Boost material visibility so Tesla is visible in deep space
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (mat.isMeshStandardMaterial) {
              mat.emissive = mat.emissive ?? new THREE.Color(0x000000);
              mat.emissiveIntensity = 0.08;
              mat.emissive.copy(mat.color).multiplyScalar(0.15);
              mat.needsUpdate = true;
            }
          }
        });

        this.starmanGroup.add(model);
        resolve();
      };

      const loadFallback = () => {
        loader.load('2008_tesla_roadster.glb', onModelLoaded, undefined, () => {
          // Fallback: simple red box if GLB fails
          const fallback = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 0.12, 0.15),
            new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.3, metalness: 0.7 })
          );
          this.starmanGroup.add(fallback);
          resolve();
        });
      };

      loader.load('/2008_tesla_roadster.glb', onModelLoaded, undefined, loadFallback);
    }));

    // Dedicated key+fill lights so the Tesla is visible against black space
    const keyLight = new THREE.PointLight(0xfff5e0, 2, 5, 1.5);
    keyLight.position.set(0.8, 0.6, 0.4);
    this.starmanGroup.add(keyLight);
    const fillLight = new THREE.PointLight(0x4488cc, 0.5, 4, 1.5);
    fillLight.position.set(-0.5, -0.2, -0.6);
    this.starmanGroup.add(fillLight);

    this.starmanGroup.visible = false;
    this.scene.add(this.starmanGroup);
  }

  private updateFalcon9(time: number) {
    if (!this.falconLaunched || !this.falconGroup) return;

    const elapsed = time - this.falconLaunchTime;
    const t = Math.min(elapsed / this.falconFlightDuration, 1);

    const targetPosition = this.getFalconFlightTarget(t);
    this.physicsManager.setTranslation(this.falconGroup, targetPosition, true);
    this.maybeTriggerFalconHyperspace(t);
    this.updateFalconExhaustTimers(elapsed);

    const s1Light = this.falconExhaust.getObjectByName('exhaustLight') as THREE.PointLight;
    const s2Light = this.falconSecondExhaust.getObjectByName('exhaustLight2') as THREE.PointLight;
    const phaseState = this.getFalconPhaseState(t, targetPosition, s1Light, s2Light);
    this.updateFalconExhaustScale(t, phaseState.thrust);
    this.updateFalconCameraTracking(t, elapsed, targetPosition, phaseState.thrust);
    this.emitFalconTelemetry(t, phaseState.thrust, phaseState.phase);

    if (t >= 1) {
      this.finalizeFalconLanding();
    }
  }

  private maybeTriggerFalconHyperspace(t: number) {
    if (t >= 0.24 && !this.falconHyperspaceTriggered) {
      this.falconHyperspaceTriggered = true;
      this.triggerHyperspaceJump();
    }
  }

  private updateFalconExhaustTimers(elapsed: number) {
    const s1Mat = this.falconExhaust.material as THREE.ShaderMaterial;
    s1Mat.uniforms['uTime'].value = elapsed;
    const s2Mat = this.falconSecondExhaust.material as THREE.ShaderMaterial;
    s2Mat.uniforms['uTime'].value = elapsed;
  }

  private getFalconPhaseState(t: number, targetPosition: THREE.Vector3, s1Light: THREE.PointLight | null, s2Light: THREE.PointLight | null) {
    if (t < 0.22) {
      return this.handleFalconLaunchAndSeparation(t, s1Light, s2Light);
    }

    if (t < 0.82) {
      return this.handleFalconCruise(t, s2Light);
    }

    return this.handleFalconLandingPhase(t, targetPosition, s2Light);
  }

  private handleFalconLaunchAndSeparation(t: number, s1Light: THREE.PointLight | null, s2Light: THREE.PointLight | null) {
    if (t < 0.14) {
      const thrust = 2;
      const phase = t < 0.06 ? 'LIFTOFF' : 'MAX-Q';
      this.falconGroup.lookAt(this.getFalconFlightTarget(Math.min(t + 0.05, 1)));
      this.falconExhaust.visible = true;
      this.falconSecondExhaust.visible = false;
      if (s1Light) s1Light.intensity = thrust * 3;
      this.falconLegs.forEach(leg => leg.rotation.x = 0);
      return { thrust, phase };
    }

    if (t < 0.16) {
      this.falconExhaust.visible = false;
      if (s1Light) s1Light.intensity = 0;
      return { thrust: 0, phase: 'MECO' };
    }

    if (t < 0.18) {
      this.handleFalconStageSeparation();
      return { thrust: 0, phase: 'STAGE SEP' };
    }

    if (t < 0.2) {
      const thrust = 1.2;
      this.falconSecondExhaust.visible = true;
      if (s2Light) s2Light.intensity = 3;
      this.falconGroup.lookAt(this.getFalconFlightTarget(Math.min(t + 0.05, 1)));
      if (this.falconFirstStage.parent === this.scene) {
        // Continue the flip — first stage rotates 180° for boostback
        this.falconFirstStage.rotateX(0.10);
        // Keep drifting apart from second stage
        this.falconFirstStage.position.y -= 0.028;
        this.falconFirstStage.position.x -= 0.015;
      }
      return { thrust, phase: 'MVAC IGN' };
    }

    const thrust = 1.2;
    this.handleFalconFairingSeparation(s1Light, s2Light, t);
    return { thrust, phase: 'FAIRING SEP' };
  }

  private handleFalconStageSeparation() {
    if (!this.falconSeparated) {
      this.falconSeparated = true;
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      this.falconFirstStage.getWorldPosition(worldPos);
      this.falconFirstStage.getWorldQuaternion(worldQuat);
      this.falconFirstStage.getWorldScale(worldScale);
      this.falconGroup.remove(this.falconFirstStage);
      this.falconFirstStage.position.copy(worldPos);
      this.falconFirstStage.quaternion.copy(worldQuat);
      this.falconFirstStage.scale.copy(worldScale);
      this.scene.add(this.falconFirstStage);

      // Cold gas thruster flash at the interstage — brief bright puff
      const flashLight = new THREE.PointLight(0xffffff, 8, 2, 2);
      flashLight.position.copy(worldPos);
      this.scene.add(flashLight);
      // Fade out the flash over 400ms
      const startTime = Date.now();
      const fadeFlash = () => {
        const elapsed = Date.now() - startTime;
        if (elapsed > 400) {
          this.scene.remove(flashLight);
          flashLight.dispose();
          return;
        }
        flashLight.intensity = 8 * (1 - elapsed / 400);
        requestAnimationFrame(fadeFlash);
      };
      requestAnimationFrame(fadeFlash);
    }
    // Strong push-off: first stage falls away rapidly to create visible gap
    this.falconFirstStage.position.y -= 0.06;
    this.falconFirstStage.position.x -= 0.035;
    // Begin the signature Falcon 9 flip — rotate towards boostback orientation
    this.falconFirstStage.rotateX(0.12);
  }

  private handleFalconFairingSeparation(s1Light: THREE.PointLight | null, s2Light: THREE.PointLight | null, t: number) {
    this.falconSecondExhaust.visible = true;
    if (s2Light) s2Light.intensity = 2;

    if (!this.falconFairingsJettisoned) {
      this.falconFairingsJettisoned = true;
      const worldScale = new THREE.Vector3();
      this.falconGroup.getWorldScale(worldScale);
      this.detachFalconFairing(this.falconFairingL, worldScale);
      this.detachFalconFairing(this.falconFairingR, worldScale);
    }

    // Fairings tumble outward dramatically
    if (this.falconFairingL.parent === this.scene) {
      this.falconFairingL.position.x -= 0.018;
      this.falconFairingL.position.y -= 0.004;
      this.falconFairingL.rotateZ(0.08);
      this.falconFairingL.rotateY(0.03);
      this.falconFairingR.position.x += 0.018;
      this.falconFairingR.position.y -= 0.004;
      this.falconFairingR.rotateZ(-0.08);
      this.falconFairingR.rotateY(-0.03);
    }

    if (this.falconFirstStage.parent === this.scene) {
      this.falconExhaust.visible = true;
      if (s1Light) s1Light.intensity = 2;
      this.falconFirstStage.rotateX(0.03);
    }

    this.falconGroup.lookAt(this.getFalconFlightTarget(Math.min(t + 0.05, 1)));
  }

  private detachFalconFairing(fairing: THREE.Object3D, worldScale: THREE.Vector3) {
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    fairing.getWorldPosition(worldPos);
    fairing.getWorldQuaternion(worldQuat);
    this.falconSecondStage.remove(fairing);
    fairing.position.copy(worldPos);
    fairing.quaternion.copy(worldQuat);
    fairing.scale.copy(worldScale);
    this.scene.add(fairing);
  }

  private handleFalconCruise(t: number, s2Light: THREE.PointLight | null) {
    const thrust = t < 0.4 ? 1 : 0;
    this.falconSecondExhaust.visible = thrust > 0;
    if (s2Light) s2Light.intensity = thrust > 0 ? 2 : 0;
    this.falconGroup.lookAt(this.getFalconFlightTarget(Math.min(t + 0.02, 1)));

    if (this.falconFairingsJettisoned && this.falconFairingL.parent === this.scene) {
      this.falconFairingL.position.x -= 0.002;
      this.falconFairingL.rotateZ(0.01);
      this.falconFairingR.position.x += 0.002;
      this.falconFairingR.rotateZ(-0.01);
      if (t > 0.32) {
        this.falconFairingL.visible = false;
        this.falconFairingR.visible = false;
      }
    }

    if (this.falconSeparated && this.falconFirstStage.parent === this.scene) {
      this.updateFirstStageReturn(t);
    }

    return { thrust, phase: 'COAST' };
  }

  private handleFalconLandingPhase(t: number, targetPosition: THREE.Vector3, s2Light: THREE.PointLight | null) {
    const thrust = (1 - t) * 3 + 0.5;
    const phase = t < 0.9 ? 'ENTRY BURN' : 'HOVERSLAM';
    this.falconSecondExhaust.visible = true;
    if (s2Light) s2Light.intensity = thrust * 2;
    this.falconGroup.lookAt(targetPosition.clone().sub(new THREE.Vector3(0, 1, 0)));
    return { thrust, phase };
  }

  private updateFalconExhaustScale(t: number, thrust: number) {
    const time = (Date.now() - this.startTime) * 0.001;
    if (this.falconExhaust.visible) {
      const s1Thrust = t < 0.14 ? thrust : 1;
      // Smooth sine-based flicker instead of Math.random() which causes per-frame jitter
      const s1Flicker = 1 + Math.sin(time * 25) * 0.08 + Math.sin(time * 37) * 0.05;
      this.falconExhaust.scale.set(s1Thrust, s1Thrust * s1Flicker, s1Thrust);
    }

    if (this.falconSecondExhaust.visible) {
      const s2Thrust = Math.max(0.3, thrust);
      const s2Flicker = 1 + Math.sin(time * 30) * 0.06 + Math.sin(time * 43) * 0.04;
      this.falconSecondExhaust.scale.set(s2Thrust * 0.6, s2Thrust * 0.6 * s2Flicker, s2Thrust * 0.6);
    }
  }

  private updateFalconCameraTracking(t: number, elapsed: number, targetPosition: THREE.Vector3, thrust: number) {
    this.cameraLerpSpeed = 0.06;

    if (t < 0.12 && this.earthMesh) {
      this.targetCameraX = this.earthMesh.position.x + 0.8;
      this.targetCameraY = this.earthMesh.position.y + 0.3;
      this.targetCameraZ = this.earthMesh.position.z + 1.8;
      this.targetLookAt.copy(targetPosition);
      return;
    }

    if (t < 0.19 && this.earthMesh) {
      this.targetCameraX = targetPosition.x + 2;
      this.targetCameraY = targetPosition.y + 0.5;
      this.targetCameraZ = targetPosition.z + 3;
      this.targetLookAt.copy(targetPosition);
      if (this.falconSeparated && this.falconFirstStage.parent === this.scene) {
        this.targetLookAt.copy(new THREE.Vector3().lerpVectors(targetPosition, this.falconFirstStage.position, 0.3));
      }
      return;
    }

    if (t < 0.3 && this.earthMesh) {
      const lerpT = (t - 0.19) / 0.11;
      this.targetCameraX = this.earthMesh.position.x - 1.5 - lerpT * 1.5;
      this.targetCameraY = this.earthMesh.position.y + 1.5 + lerpT * 2;
      this.targetCameraZ = this.earthMesh.position.z + 4 + lerpT * 2;
      this.targetLookAt.copy(targetPosition);
      return;
    }

    if (t < 0.8) {
      const chaseT = (t - 0.3) / 0.5;
      const angle = chaseT * 0.8;
      const offset = new THREE.Vector3(
        Math.cos(angle) * 2.5,
        0.8 + Math.sin(chaseT * Math.PI),
        Math.sin(angle) * 2.5 + 2
      );
      this.targetCameraX = targetPosition.x + offset.x;
      this.targetCameraY = targetPosition.y + offset.y;
      this.targetCameraZ = targetPosition.z + offset.z;
      this.targetLookAt.copy(targetPosition);
      return;
    }

    if (this.marsMesh) {
      this.targetCameraX = this.marsMesh.position.x + 1.5;
      this.targetCameraY = this.marsMesh.position.y + 0.3;
      this.targetCameraZ = this.marsMesh.position.z + 2.5;
      this.targetLookAt.copy(targetPosition);
      const landT = elapsed * 12;
      this.targetCameraX += Math.sin(landT) * thrust * 0.008;
      this.targetCameraY += Math.cos(landT * 1.3) * thrust * 0.005;
    }
  }

  private emitFalconTelemetry(t: number, thrust: number, phase: string) {
    this.ngZone.run(() => {
      this.telemetry.emit({
        altitude: Math.round((1 - t) * 250000),
        speed: Math.round(Math.max(thrust, 0.5) * 8000),
        phase
      });
    });
  }

  private updateFirstStageReturn(t: number) {
    // First stage: boostback → flip → coast → entry burn → hoverslam landing
    const returnT = Math.min(1, (t - 0.16) / 0.6);
    if (!this.earthMesh) return;

    const landingSpot = this.earthMesh.position.clone().add(new THREE.Vector3(0.6, 0.5, 0.6));

    if (returnT < 0.15) {
      // Boostback burn — engines reignite, stage flips to face Earth
      this.falconExhaust.visible = true;
      const s1Light = this.falconExhaust.getObjectByName('exhaustLight') as THREE.PointLight;
      if (s1Light) s1Light.intensity = 4;
      this.falconFirstStage.position.lerp(landingSpot, 0.006);
      // Smoothly orient towards landing spot
      const lookTarget = landingSpot.clone();
      const dir = lookTarget.sub(this.falconFirstStage.position).normalize();
      const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      this.falconFirstStage.quaternion.slerp(targetQuat, 0.04);
    } else if (returnT < 0.5) {
      // Coast — engines off, ballistic arc
      this.falconExhaust.visible = false;
      const s1Light = this.falconExhaust.getObjectByName('exhaustLight') as THREE.PointLight;
      if (s1Light) s1Light.intensity = 0;
      this.falconFirstStage.position.lerp(landingSpot, 0.010);
      // Grid fins steer — slight roll
      this.falconFirstStage.rotateZ(0.003);
    } else if (returnT < 0.75) {
      // Entry burn — 3 engines relight to slow down in atmosphere
      this.falconExhaust.visible = true;
      const s1Light = this.falconExhaust.getObjectByName('exhaustLight') as THREE.PointLight;
      if (s1Light) s1Light.intensity = 3;
      this.falconFirstStage.position.lerp(landingSpot, 0.02);
      this.falconFirstStage.lookAt(landingSpot);
    } else {
      // Hoverslam / landing burn — single engine, legs deploy, precision landing
      this.falconExhaust.visible = true;
      const s1Light = this.falconExhaust.getObjectByName('exhaustLight') as THREE.PointLight;
      const landingProgress = (returnT - 0.75) / 0.25;
      // Engine thrust tapers as it touches down
      if (s1Light) s1Light.intensity = Math.max(0.5, (1 - landingProgress) * 8);
      this.falconFirstStage.position.lerp(landingSpot, 0.05);
      this.falconFirstStage.lookAt(landingSpot);
      // Deploy landing legs progressively
      const deployT = Math.min(1, (returnT - 0.75) / 0.10);
      this.falconLegs.forEach(leg => leg.rotation.x = deployT * 1.2);
      // Kill exhaust right at touchdown
      if (landingProgress > 0.95) {
        this.falconExhaust.visible = false;
        if (s1Light) s1Light.intensity = 0;
      }
    }
  }

  private getShootingStarOpacity(progress: number): number {
    if (progress < 0.1) {
      return progress / 0.1;
    }

    if (progress > 0.7) {
      return (1 - progress) / 0.3;
    }

    return 1;
  }

  private createSolarSystemPlanets() {
    this.createSaturnSystem();
    this.createTitanAndPluto();
    this.createMarsSystem();
    this.createVenusSystem();
    this.createMercurySystem();
    this.createUranusSystem();
    this.createNeptuneSystem();
  }

  private createSaturnSystem() {
    // Saturn — visible in far background
    // Saturn equatorial radius: 60,268 km → 60268/71492 × 10 = 8.43 scene units
    this.saturnGroup = new THREE.Group();
    const saturnGeo = new THREE.SphereGeometry(8.4, 48, 48);
    const saturnMat = new THREE.MeshStandardMaterial({
      color: 0xd4b06a, roughness: 0.5, metalness: 0.1
    });
    const saturn = new THREE.Mesh(saturnGeo, saturnMat);
    this.saturnGroup.add(saturn);

    // Load Saturn texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('8k_saturn.webp', (tex) => {
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
        saturnMat.map = tex; saturnMat.color.setHex(0xffffff); saturnMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Saturn's iconic rings (C ring inner to F ring outer)
    // Real: C ring at 1.24 Rs, A ring outer at 2.27 Rs → 10.4 to 19.1 scene units
    const innerR = 10.4, outerR = 19.1;
    const satRingGeo = new THREE.RingGeometry(innerR, outerR, 256, 8);
    // High-res procedural ring texture with Cassini division and fine structure
    const ringCanvas = document.createElement('canvas');
    ringCanvas.width = 1024; ringCanvas.height = 1;
    const rCtx = ringCanvas.getContext('2d')!;
    for (let x = 0; x < 1024; x++) {
      const t = x / 1024;
      let opacity = 0;
      let r = 210, g = 190, b = 150;
      // Fine micro-structure using high-frequency noise
      const micro = 0.92 + 0.08 * Math.sin(t * 400 + Math.sin(t * 150) * 2);
      if (t < 0.22) { // C ring (inner, faint, brownish)
        opacity = (0.12 + Math.sin(t * 120) * 0.04) * micro;
        r = 150; g = 130; b = 100;
      } else if (t < 0.28) { // C-B transition
        opacity = (0.2 + (t - 0.22) / 0.06 * 0.4) * micro;
        r = 180; g = 165; b = 130;
      } else if (t < 0.54) { // B ring (brightest, most opaque)
        opacity = (0.65 + Math.sin(t * 200) * 0.08 + Math.sin(t * 50) * 0.05) * micro;
        r = 215; g = 195; b = 155;
      } else if (t < 0.6) { // Cassini Division (prominent gap)
        opacity = 0.03 + Math.sin(t * 300) * 0.01;
        r = 80; g = 70; b = 55;
      } else if (t < 0.83) { // A ring (medium opacity, warm)
        opacity = (0.4 + Math.sin(t * 160) * 0.06 + Math.sin(t * 80) * 0.04) * micro;
        r = 200; g = 182; b = 145;
        // Encke Gap at ~0.74
        if (t > 0.73 && t < 0.75) opacity *= 0.15;
      } else if (t < 0.86) { // Roche Division
        opacity = 0.02;
      } else if (t < 0.9) { // F ring (thin, bright)
        const fCenter = 0.88;
        const fDist = Math.abs(t - fCenter);
        opacity = Math.max(0, 0.35 - fDist * 15) * micro;
        r = 220; g = 200; b = 165;
      } else { // Beyond F ring
        opacity = 0.01;
      }
      rCtx.fillStyle = `rgba(${r},${g},${b},${Math.min(opacity, 1)})`;
      rCtx.fillRect(x, 0, 1, 1);
    }
    const ringTexture = new THREE.CanvasTexture(ringCanvas);
    ringTexture.wrapS = THREE.ClampToEdgeWrapping;
    ringTexture.generateMipmaps = false;
    ringTexture.minFilter = THREE.LinearFilter;
    ringTexture.magFilter = THREE.LinearFilter;
    // Custom lit ring shader — scatters sunlight with forward/back-scatter
    const satRingMat = new THREE.ShaderMaterial({
      uniforms: {
        uRingTex: { value: ringTexture },
        uSunDir: { value: new THREE.Vector3(-0.8, 0.2, 0.56).normalize() },
        uPlanetPos: { value: new THREE.Vector3(0, 0, 0) },
        uPlanetRadius: { value: 8.4 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uRingTex;
        uniform vec3 uSunDir;
        uniform vec3 uPlanetPos;
        uniform float uPlanetRadius;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        void main() {
          vec4 texel = texture2D(uRingTex, vUv);
          if (texel.a < 0.01) discard;

          // Ring-plane normal for lighting
          vec3 N = normalize(vWorldNormal);
          float NdotL = dot(N, uSunDir);

          // Forward scatter (viewing through rings toward sun) + back scatter
          float scatter = 0.4 + 0.35 * abs(NdotL) + 0.25 * pow(max(NdotL, 0.0), 2.0);

          // Planet shadow on rings
          vec3 toSun = uSunDir;
          vec3 ringToPlanet = uPlanetPos - vWorldPos;
          float projDist = dot(ringToPlanet, toSun);
          float shadow = 1.0;
          if (projDist > 0.0) {
            vec3 closestPoint = vWorldPos + toSun * projDist;
            float distFromAxis = length(closestPoint - uPlanetPos);
            shadow = smoothstep(uPlanetRadius * 0.85, uPlanetRadius * 1.05, distFromAxis);
          }

          vec3 lit = texel.rgb * scatter * shadow;
          gl_FragColor = vec4(lit, texel.a * shadow);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
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
    satRingGeo.computeVertexNormals();
    const satRing = new THREE.Mesh(satRingGeo, satRingMat);
    satRing.rotation.x = Math.PI / 2; // Flat in equatorial plane — group rotation handles tilt
    this.saturnGroup.add(satRing);

    // Saturn position: far behind and to the right
    // Real: Saturn orbit ~9.5 AU, Jupiter 5.2 AU. Place it distant
    this.saturnGroup.position.set(120, 20, -200);
    this.saturnGroup.rotation.z = 0.466; // Saturn tilt: 26.7°
    this.scene.add(this.saturnGroup);
  }

  private createTitanAndPluto() {
    // ─── Titan — Saturn's largest moon ───────────────────────────────────
    const titanGeo = new THREE.SphereGeometry(0.5, 24, 24);
    const titanMat = new THREE.MeshStandardMaterial({
      color: 0xcc9944, roughness: 0.85, metalness: 0.05
    });
    this.titanMesh = new THREE.Mesh(titanGeo, titanMat);
    const saturnPosition = this.saturnGroup.position;
    this.titanMesh.position.set(saturnPosition.x + 20, saturnPosition.y, saturnPosition.z);
    this.scene.add(this.titanMesh);
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('8k_moon.webp', (tex) => {
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
        titanMat.map = tex;
        titanMat.color.setHex(0xcc9944);
        titanMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Titan's thick nitrogen-methane haze (characteristic orange glow — Cassini/Huygens)
    const titanAtmoMat = new THREE.ShaderMaterial({
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
          fresnel = pow(fresnel, 2.2);
          // Thick orange photochemical haze — Titan's signature look
          vec3 col = mix(vec3(0.85, 0.55, 0.2), vec3(1.0, 0.75, 0.35), fresnel);
          gl_FragColor = vec4(col, fresnel * 0.6);
        }`,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.titanMesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.58, 24, 24), titanAtmoMat));

    // ─── Pluto — dwarf planet beyond Neptune ─────────────────────────────
    const plutoGeo = new THREE.SphereGeometry(0.32, 32, 32);
    const plutoMat = new THREE.MeshStandardMaterial({
      color: 0xd8c0a0, roughness: 0.92, metalness: 0
    });
    this.plutoMesh = new THREE.Mesh(plutoGeo, plutoMat);
    this.plutoMesh.position.set(-240, -25, -220);
    this.scene.add(this.plutoMesh);
    this.createPlutoExplosionVFX();
    this.createBlackHole();
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('8k_moon.webp', (tex) => {
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
        plutoMat.map = tex;
        plutoMat.color.setHex(0xd8c0a0);
        plutoMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Pluto's thin nitrogen atmosphere — backlit blue haze (New Horizons flyby imagery)
    const plutoAtmoMat = new THREE.ShaderMaterial({
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
          // Blue nitrogen haze — New Horizons revealed this backlit glow
          vec3 col = mix(vec3(0.4, 0.55, 0.8), vec3(0.6, 0.75, 1.0), fresnel);
          gl_FragColor = vec4(col, fresnel * 0.35);
        }`,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.plutoMesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 20), plutoAtmoMat));
  }

  private createMarsSystem() {
    // Mars — small red dot in the inner solar system direction
    const marsGeo = new THREE.SphereGeometry(0.475, 32, 32);
    const marsMat = new THREE.MeshStandardMaterial({
      color: 0xc1440e, roughness: 0.8, metalness: 0.1
    });
    this.marsMesh = new THREE.Mesh(marsGeo, marsMat);
    this.marsMesh.position.set(-55, -5, 20);
    this.scene.add(this.marsMesh);

    // Load Mars texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('8k_mars.webp', (tex) => {
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
        marsMat.map = tex; marsMat.color.setHex(0xffffff); marsMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));

    // Mars atmosphere (thin, subtle — real Mars atmosphere is only 1% of Earth's)
    // Fresnel-based shader gives a realistic dusty-orange limb glow
    const marsAtmoMat = new THREE.ShaderMaterial({
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
          fresnel = pow(fresnel, 4.0);
          // Dusty peach-orange Mars limb — very thin
          vec3 col = mix(vec3(0.9, 0.5, 0.25), vec3(1.0, 0.65, 0.35), fresnel);
          gl_FragColor = vec4(col, fresnel * 0.3);
        }`,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const marsAtmo = new THREE.Mesh(new THREE.SphereGeometry(0.52, 24, 24), marsAtmoMat);
    this.marsMesh.add(marsAtmo);
  }

  private createVenusSystem() {
    // Venus — inner solar system, near the Sun direction
    const venusGeo = new THREE.SphereGeometry(0.846, 48, 48);
    const venusMat = new THREE.MeshStandardMaterial({ color: 0xe8cda0, roughness: 0.7, metalness: 0.05 });
    this.venusMesh = new THREE.Mesh(venusGeo, venusMat);
    this.venusMesh.position.set(-42, 8, 25);
    this.scene.add(this.venusMesh);
    // Venus atmosphere texture (thick sulfuric acid clouds)
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('8k_venus_surface.webp', (tex) => {
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
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
          fresnel = pow(fresnel, 3.5);
          vec3 col = mix(vec3(0.95, 0.85, 0.6), vec3(1.0, 0.92, 0.7), fresnel);
          gl_FragColor = vec4(col, fresnel * 0.2);
        }`,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.venusMesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 32), venusAtmoMat));
  }

  private createMercurySystem() {
    // Mercury — smallest planet, closest to the Sun
    const mercuryGeo = new THREE.SphereGeometry(0.341, 48, 48);
    const mercuryMat = new THREE.MeshStandardMaterial({ color: 0xa0a0a0, roughness: 0.9, metalness: 0.15 });
    this.mercuryMesh = new THREE.Mesh(mercuryGeo, mercuryMat);
    this.mercuryMesh.position.set(-35, 5, 15);
    this.scene.add(this.mercuryMesh);
    // Mercury texture — cratered surface
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('8k_mercury.webp', (tex) => {
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
        mercuryMat.map = tex; mercuryMat.color.setHex(0xffffff); mercuryMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));
  }

  private createUranusSystem() {
    // Uranus — distant ice giant, opposite direction from Sun
    this.uranusGroup = new THREE.Group();
    const uranusGeo = new THREE.SphereGeometry(3.575, 48, 48);
    const uranusMat = new THREE.MeshStandardMaterial({ color: 0x9dd8d8, roughness: 0.4, metalness: 0.05 });
    this.uranusMesh = new THREE.Mesh(uranusGeo, uranusMat);
    this.uranusGroup.add(this.uranusMesh);
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_uranus.webp', (tex) => {
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
        uranusMat.map = tex; uranusMat.color.setHex(0xffffff); uranusMat.needsUpdate = true;
        resolve();
      }, undefined, () => resolve());
    }));
    this.addUranusAtmosphere();
    this.addUranusRings();
    this.uranusGroup.position.set(160, -10, 150);
    this.uranusGroup.rotation.z = 1.71;
    this.scene.add(this.uranusGroup);
  }

  private addUranusAtmosphere() {
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
  }

  private addUranusRings() {
    const ringInner = 5;
    const ringOuter = 7.4;
    const ringGeometry = new THREE.RingGeometry(ringInner, ringOuter, 128, 4);
    const ringTexture = this.createUranusRingTexture();
    const ringMaterial = new THREE.MeshBasicMaterial({
      map: ringTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false
    });
    const ringUv = ringGeometry.attributes['uv'] as THREE.BufferAttribute;
    const ringPosition = ringGeometry.attributes['position'];
    const ringVector = new THREE.Vector3();
    for (let index = 0; index < ringPosition.count; index++) {
      ringVector.fromBufferAttribute(ringPosition as THREE.BufferAttribute, index);
      const dist = ringVector.length();
      ringUv.setXY(index, (dist - ringInner) / (ringOuter - ringInner), 0.5);
    }
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    this.uranusGroup.add(ring);
  }

  private createUranusRingTexture() {
    const ringCanvas = document.createElement('canvas');
    ringCanvas.width = 512;
    ringCanvas.height = 64;
    const context = ringCanvas.getContext('2d')!;
    for (let x = 0; x < 512; x++) {
      const t = x / 512;
      const opacity = this.getUranusRingOpacity(t);
      context.fillStyle = `rgba(160,170,180,${opacity})`;
      context.fillRect(x, 0, 1, 64);
    }
    const ringTexture = new THREE.CanvasTexture(ringCanvas);
    ringTexture.wrapS = THREE.ClampToEdgeWrapping;
    ringTexture.generateMipmaps = false;
    ringTexture.minFilter = THREE.LinearFilter;
    ringTexture.magFilter = THREE.LinearFilter;
    return ringTexture;
  }

  private getUranusRingOpacity(t: number): number {
    const fixedBands = [
      { min: 0.05, max: 0.08, opacity: 0.12 },
      { min: 0.12, max: 0.15, opacity: 0.1 },
      { min: 0.2, max: 0.24, opacity: 0.15 },
      { min: 0.35, max: 0.4, opacity: 0.12 },
      { min: 0.45, max: 0.52, opacity: 0.14 },
      { min: 0.6, max: 0.65, opacity: 0.1 },
      { min: 0.7, max: 0.72, opacity: 0.08 },
      { min: 0.75, max: 0.78, opacity: 0.09 },
    ];
    const match = fixedBands.find(({ min, max }) => t > min && t < max);
    if (match) {
      return match.opacity;
    }

    if (t > 0.82 && t < 0.95) {
      return 0.2 + Math.sin(t * 80) * 0.05;
    }

    return 0;
  }

  private createNeptuneSystem() {
    // Neptune — farthest giant planet
    this.neptuneGroup = new THREE.Group();
    const neptuneGeo = new THREE.SphereGeometry(3.464, 48, 48);
    const neptuneMat = new THREE.MeshStandardMaterial({ color: 0x3366cc, roughness: 0.4, metalness: 0.05 });
    this.neptuneMesh = new THREE.Mesh(neptuneGeo, neptuneMat);
    this.neptuneGroup.add(this.neptuneMesh);
    // Neptune texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('2k_neptune.webp', (tex) => {
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
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
      if (t > 0.45 && t < 0.5) opacity = 0.03; // Lassell ring (faint)
      if (t > 0.75 && t < 0.82) opacity = 0.08 + Math.sin(t * 60) * 0.03; // Adams ring (with arcs)
      nRCtx.fillStyle = `rgba(140,150,170,${opacity})`;
      nRCtx.fillRect(x, 0, 1, 64);
    }
    const neptuneRingTex = new THREE.CanvasTexture(neptuneRingCanvas);
    neptuneRingTex.wrapS = THREE.ClampToEdgeWrapping;
    neptuneRingTex.generateMipmaps = false;
    neptuneRingTex.minFilter = THREE.LinearFilter;
    neptuneRingTex.magFilter = THREE.LinearFilter;
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
    canvas.width = 512;
    canvas.height = 128;
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = '700 54px "Pathway Gothic One", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Subtle glow behind text
    ctx.shadowColor = 'rgba(180,210,255,0.7)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(230,240,255,0.9)';
    ctx.fillText(text, 256, 64);
    // Second pass for crispness
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(20,30,60,0.8)';
    ctx.lineWidth = 5;
    ctx.strokeText(text, 256, 64);
    ctx.fillStyle = 'rgba(240,248,255,0.95)';
    ctx.fillText(text, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const spriteMat = new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.NormalBlending, fog: false, opacity: 0.95
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

    // Pluto
    const plutoLabel = this.createLabelSprite('Pluto', 0.8);
    plutoLabel.position.set(0, 1, 0);
    this.plutoMesh.add(plutoLabel);
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

  private createAsbjornMeteorStorm() {
    // Canvas renders "ASBJØRN" into a pixel grid → sample lit pixels for meteorite positions
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 90px "Pathway Gothic One", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ASBJØRN', canvas.width / 2, canvas.height / 2);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const positions: number[] = [];
    const glowPositions: number[] = [];
    const glowColors: number[] = [];
    const glowSizes: number[] = [];

    // Sample every 4th pixel for a subtle, diffuse look
    for (let y = 0; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 4) {
        const idx = (y * canvas.width + x) * 4;
        if (imgData[idx] > 128) {
          const px = (x - canvas.width / 2) * 0.18;
          const py = -(y - canvas.height / 2) * 0.18;
          const pz = (Math.random() - 0.5) * 3;
          positions.push(px, py, pz);
          // Glow particles — two per rock for density
          glowPositions.push(px + (Math.random() - 0.5) * 0.8, py + (Math.random() - 0.5) * 0.8, pz + (Math.random() - 0.5) * 0.8);
          const warm = 0.5 + Math.random() * 0.5;
          glowColors.push(1.0, 0.6 * warm, 0.2 * warm);
          glowSizes.push(1.5 + Math.random() * 3);
        }
      }
    }

    this.asbjornMeteorCount = positions.length / 3;
    if (this.asbjornMeteorCount === 0) return;

    // Procedural rocky texture via canvas
    const texCanvas = document.createElement('canvas');
    texCanvas.width = 64; texCanvas.height = 64;
    const tCtx = texCanvas.getContext('2d')!;
    // Base dark rock color
    tCtx.fillStyle = '#3a3228';
    tCtx.fillRect(0, 0, 64, 64);
    // Rocky noise spots
    for (let i = 0; i < 200; i++) {
      const rx = Math.random() * 64;
      const ry = Math.random() * 64;
      const rs = 1 + Math.random() * 4;
      const shade = Math.floor(30 + Math.random() * 50);
      tCtx.fillStyle = `rgb(${shade + 20}, ${shade + 10}, ${shade})`;
      tCtx.beginPath();
      tCtx.arc(rx, ry, rs, 0, Math.PI * 2);
      tCtx.fill();
    }
    // Lighter mineral veins
    for (let i = 0; i < 8; i++) {
      tCtx.strokeStyle = `rgba(${120 + Math.random() * 60}, ${100 + Math.random() * 40}, ${70 + Math.random() * 30}, 0.4)`;
      tCtx.lineWidth = 0.5 + Math.random();
      tCtx.beginPath();
      tCtx.moveTo(Math.random() * 64, Math.random() * 64);
      tCtx.quadraticCurveTo(Math.random() * 64, Math.random() * 64, Math.random() * 64, Math.random() * 64);
      tCtx.stroke();
    }
    const rockTex = new THREE.CanvasTexture(texCanvas);
    rockTex.generateMipmaps = false;
    rockTex.minFilter = THREE.LinearFilter;

    // InstancedMesh rocks — irregularly shaped meteorites
    const rockGeo = new THREE.IcosahedronGeometry(0.35, 1);
    const rockMat = new THREE.MeshStandardMaterial({
      map: rockTex,
      roughness: 0.95,
      metalness: 0.15,
      color: 0x6b5c4a,
    });
    this.asbjornMeteorRocks = new THREE.InstancedMesh(rockGeo, rockMat, this.asbjornMeteorCount);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.asbjornMeteorCount; i++) {
      dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      const s = 0.4 + Math.random() * 0.8;
      dummy.scale.set(s, s * (0.5 + Math.random() * 0.5), s * (0.6 + Math.random() * 0.4));
      dummy.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
      dummy.updateMatrix();
      this.asbjornMeteorRocks.setMatrixAt(i, dummy.matrix);
      // Subtle color variation — warm browns to charcoal
      const shade = 0.25 + Math.random() * 0.25;
      this.asbjornMeteorRocks.setColorAt(i, new THREE.Color(shade + 0.08, shade, shade - 0.04));
    }
    this.asbjornMeteorRocks.instanceColor!.needsUpdate = true;

    // Warm ember glow particles around each rock
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPositions, 3));
    glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(glowColors, 3));
    glowGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(glowSizes, 1));

    const glowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aSize;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uTime;
        void main() {
          vColor = color;
          vec3 pos = position;
          // Gentle drift — each particle oscillates slightly
          pos.x += sin(uTime * 0.3 + position.y * 2.0) * 0.15;
          pos.y += cos(uTime * 0.25 + position.x * 1.5) * 0.12;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = aSize * (120.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float glow = exp(-d * 5.0);
          gl_FragColor = vec4(vColor, glow * 0.35);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.asbjornMeteorGlow = new THREE.Points(glowGeo, glowMat);

    // Group into a container, place far off to the upper-right of the scene
    // visible as a subtle background feature — like a distant meteorite cloud
    this.asbjornStormGroup = new THREE.Group();
    this.asbjornStormGroup.add(this.asbjornMeteorRocks);
    this.asbjornStormGroup.add(this.asbjornMeteorGlow);
    this.asbjornStormGroup.position.set(80, 55, -120);
    this.asbjornStormGroup.rotation.set(0.15, -0.3, 0.08);
    this.asbjornStormGroup.scale.setScalar(0.7);
    this.asbjornStormGroup.visible = false;
    this.scene.add(this.asbjornStormGroup);
  }

  private updateAsbjornMeteorStorm(time: number) {
    if (!this.asbjornMeteorRocks || this.asbjornMeteorCount === 0) return;

    // Slow tumble of individual rocks
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.asbjornMeteorCount; i++) {
      this.asbjornMeteorRocks.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      dummy.rotation.x += 0.001 + (i % 7) * 0.0003;
      dummy.rotation.y += 0.0008 + (i % 5) * 0.0002;
      dummy.updateMatrix();
      this.asbjornMeteorRocks.setMatrixAt(i, dummy.matrix);
    }
    this.asbjornMeteorRocks.instanceMatrix.needsUpdate = true;

    // Update glow time uniform
    if (this.asbjornMeteorGlow) {
      (this.asbjornMeteorGlow.material as THREE.ShaderMaterial).uniforms['uTime'].value = time;
    }
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
      const alpha = this.getShootingStarOpacity(progress);
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
    // Point tail away from sun.
    const toSun = this.sunPosition.clone().sub(this.cometGroup.position).normalize();
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
    // The Sun — realistic multi-layer star
    // Real: Sun radius 696,000 km = 97.4 Rj — would fill entire scene
    // Using artistic size (6 units) large enough to be prominent but not overwhelming
    const sunRadius = 6;

    // Photosphere — animated surface with limb darkening + granulation turbulence
    const sunGeo = new THREE.SphereGeometry(sunRadius, 48, 48);
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
    this.sunMesh.position.copy(this.sunPosition);

    // Load Sun texture
    this.loadPromises.push(new Promise<void>((resolve) => {
      this.textureLoader.load('8k_sun.webp', (tex) => {
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
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
          float chromo = pow(rim, 6.0) * 2.0;
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
    // Sun at (-80, 15, 50) → night side faces roughly (+x, -y, -z)

    for (let index = 0; index < 8; index++) {
      const boltGroup = this.buildLightningBoltGroup(this.getLightningStrikePosition());
      this.jupiterGroup.add(boltGroup);
      this.lightningFlashes.push({
        mesh: boltGroup as unknown as THREE.Mesh,
        timer: 0,
        cooldown: 80 + Math.random() * 300
      });
    }
  }

  private getLightningStrikePosition(): THREE.Vector3 {
    const theta = Math.random() > 0.4
      ? this.polarTheta()
      : Math.random() * Math.PI * 0.6 + Math.PI * 0.2;
    const phi = Math.random() * Math.PI - Math.PI * 0.5;
    const radius = 10.05;
    return new THREE.Vector3(
      radius * Math.sin(theta) * Math.cos(phi + Math.PI),
      radius * Math.cos(theta),
      radius * Math.sin(theta) * Math.sin(phi + Math.PI)
    );
  }

  private buildLightningBoltGroup(position: THREE.Vector3): THREE.Group {
    const boltGroup = new THREE.Group();
    boltGroup.position.copy(position);
    boltGroup.lookAt(position.x * 2, position.y * 2, position.z * 2);

    const branchCount = 1 + Math.floor(Math.random() * 3);
    for (let branch = 0; branch < branchCount; branch++) {
      boltGroup.add(this.createLightningBranch(branch === 0));
    }

    const glowMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.6 + Math.random() * 0.4, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0x8899cc,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    boltGroup.add(glowMesh);
    boltGroup.add(new THREE.PointLight(0x88aaff, 0, 3));
    return boltGroup;
  }

  private createLightningBranch(isMainBranch: boolean): THREE.Line {
    const points: THREE.Vector3[] = [];
    const segments = 6 + Math.floor(Math.random() * 4);
    let px = isMainBranch ? 0 : (Math.random() - 0.5) * 0.3;
    let py = isMainBranch ? 0 : (Math.random() - 0.5) * 0.3;
    let pz = 0;
    const boltLength = isMainBranch ? 0.6 + Math.random() * 0.4 : 0.2 + Math.random() * 0.3;
    for (let segment = 0; segment <= segments; segment++) {
      points.push(new THREE.Vector3(px, py, pz));
      px += (Math.random() - 0.5) * 0.15;
      py += (Math.random() - 0.5) * 0.15;
      pz += boltLength / segments;
    }

    const boltGeo = new THREE.BufferGeometry().setFromPoints(points);
    const boltMat = new THREE.LineBasicMaterial({
      color: isMainBranch ? 0xaaccff : 0x6688dd,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 1
    });
    return new THREE.Line(boltGeo, boltMat);
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
              const mat = child.material as THREE.LineBasicMaterial;
              mat.opacity = flicker;
            }
          });
          lf.timer = 0;
          lf.cooldown = 80 + Math.random() * 300;
          // Rewrite vertices in-place (reuse geometry buffer, no allocation)
          group.children.forEach(child => {
            if (child instanceof THREE.Line) {
              const posAttr = child.geometry.attributes['position'] as THREE.BufferAttribute;
              if (!posAttr) return;
              const segments = Math.min(posAttr.count, 6 + Math.floor(Math.random() * 4));
              let px = (Math.random() - 0.5) * 0.3;
              let py = (Math.random() - 0.5) * 0.3;
              let pz = 0;
              const boltLen = 0.3 + Math.random() * 0.5;
              for (let s = 0; s < posAttr.count; s++) {
                if (s <= segments) {
                  posAttr.setXYZ(s, px, py, pz);
                  px += (Math.random() - 0.5) * 0.15;
                  py += (Math.random() - 0.5) * 0.15;
                  pz += boltLen / segments;
                } else {
                  // Degenerate remaining verts to last point
                  posAttr.setXYZ(s, px, py, pz);
                }
              }
              posAttr.needsUpdate = true;
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
    // GPU-driven animation — positions computed in vertex shader using uTime
    const count = 400;
    const geo = new THREE.BufferGeometry();
    const offsets = new Float32Array(count);
    const spreads = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      offsets[i] = Math.random(); // random phase offset per particle
      // Random lateral spread (perpendicular to travel direction)
      spreads[i * 3] = (Math.random() - 0.5);
      spreads[i * 3 + 1] = (Math.random() - 0.5);
      spreads[i * 3 + 2] = (Math.random() - 0.5);
      sizes[i] = 0.3 + Math.random() * 0.5;
    }
    // Dummy positions — actual positions computed in vertex shader
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aOffset', new THREE.Float32BufferAttribute(offsets, 1));
    geo.setAttribute('aSpread', new THREE.Float32BufferAttribute(spreads, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    this.solarWind = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunPos: { value: this.sunPosition.clone() },
        uJupPos: { value: new THREE.Vector3(12, 0, -15) },
      },
      vertexShader: `
        attribute float aOffset;
        attribute vec3 aSpread;
        attribute float aSize;
        uniform float uTime;
        uniform vec3 uSunPos;
        uniform vec3 uJupPos;
        void main() {
          vec3 dir = uJupPos - uSunPos;
          float totalDist = length(dir);
          // t cycles from 0→1.2 based on time + per-particle offset
          float speed = 0.005;
          float t = fract(uTime * speed + aOffset);
          float spread = 8.0 + t * 15.0;
          vec3 animatedPos = uSunPos + dir * t + aSpread * spread;
          vec4 mvPosition = modelViewMatrix * vec4(animatedPos, 1.0);
          gl_PointSize = aSize * (80.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * 0.08;
          gl_FragColor = vec4(1.0, 0.95, 0.7, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    this.solarWind.frustumCulled = false;
    this.scene.add(this.solarWind);
  }

  private updateSolarWind() {
    if (!this.solarWind) return;
    const mat = this.solarWind.material as THREE.ShaderMaterial;
    mat.uniforms['uTime'].value += 1;
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
    // Jupiter is at (12, 0, -15) scene coords.
    // We place clusters at ~60° ahead and behind in Jupiter's orbit
    const jupPos = new THREE.Vector3(12, 0, -15);
    const sunPos = this.sunPosition;
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
    this.zodiacalLight.position.copy(this.sunPosition);
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
    // Skip rendering while tab is hidden to prevent time jumps
    if (this.tabHidden) return;

    const km = Math.round(588 + frac * (968 - 588));
    if (km !== this.lastEmittedKm) {
      this.lastEmittedKm = km;
      this.ngZone.run(() => this.distanceKm.emit(km));
    }
  }

  private animate() {
    this.animationFrameId = requestAnimationFrame(() => this.animate());

    const time = (Date.now() - this.startTime) * 0.001;
    const deltaTime = this.lastRenderTime === 0 ? 1 / 60 : Math.min(time - this.lastRenderTime, 1 / 15);
    this.lastRenderTime = time;

    this.updateAnimationContext();
    this.updateSceneCameraAndTour(time);
    this.updateEarthMoonAndTitan();
    this.updateDistanceBeam(time);
    this.updateImmersiveSceneEffects(deltaTime, time);
    this.updateSecondaryBodyAnimation(time);
    this.updateColumbiaSequence(deltaTime);
    this.updateSimulationStep(time);
    this.updateSunAnimation(time);
    this.postProcessManager?.render(deltaTime);
  }

  private updateAnimationContext() {
    const contextLerp = Math.min(this.cameraLerpSpeed * 0.8, 0.04);
    this.currentStarSpeed += (this.targetStarSpeed - this.currentStarSpeed) * contextLerp;
    this.currentMoonSpeedMultiplier += (this.targetMoonSpeedMultiplier - this.currentMoonSpeedMultiplier) * contextLerp;
    this.currentAtmospherePulse += (this.targetAtmospherePulse - this.currentAtmospherePulse) * 0.05;
    this.currentJupiterSpinSpeed += (this.targetJupiterSpinSpeed - this.currentJupiterSpinSpeed) * contextLerp;
    this.currentShipSpeedMultiplier += (this.targetShipSpeedMultiplier - this.currentShipSpeedMultiplier) * contextLerp;
  }

  private updateSceneCameraAndTour(time: number) {
    this.updateAtmosphere(time);
    if (this.tourActive) this.updatePlanetTour(time);
    this.updateFalcon9(time);
    this.updateCamera();
    this.updateJupiterRotation();
  }

  private updateEarthMoonAndTitan() {
    if (this.earthMesh?.visible) {
      this.earthMesh.rotation.y += 0.005;
      if (this.earthOrbitActive) {
        this.updateEarthOrbit();
      }
      this.physicsManager.setKinematicTarget(this.earthMesh, this.earthMesh.position, this.earthMesh.quaternion);
    }

    this.updateMoonState();

    if (this.titanMesh && this.saturnGroup) {
      this.titanOrbitAngle += 0.003;
      const saturnPosition = this.saturnGroup.position;
      this.titanMesh.position.set(
        saturnPosition.x + 22 * Math.cos(this.titanOrbitAngle),
        saturnPosition.y + 1.5 * Math.sin(this.titanOrbitAngle * 0.4),
        saturnPosition.z + 22 * Math.sin(this.titanOrbitAngle)
      );
      this.titanMesh.rotation.y += 0.002;
      this.physicsManager.setKinematicTarget(this.titanMesh, this.titanMesh.position, this.titanMesh.quaternion);
    }

    if (this.plutoMesh) {
      this.plutoMesh.rotation.y += 0.0008;
    }
  }

  private updateMoonState() {
    if (!this.moonMesh) {
      return;
    }

    const earthVisible = this.earthMesh?.visible ?? false;
    this.moonMesh.visible = earthVisible;
    if (earthVisible && this.earthMesh) {
      const onMoon = this.activeCameraAnchorKey === 'maan';
      if (!onMoon) {
        this.moonOrbitAngle += 0.008;
        this.moonMesh.rotation.y += 0.002;
      }
      const earthPosition = this.earthMesh.position;
      this.moonMesh.position.set(
        earthPosition.x + 2.8 * Math.cos(this.moonOrbitAngle),
        earthPosition.y + 0.3 * Math.sin(this.moonOrbitAngle * 0.5),
        earthPosition.z + 2.8 * Math.sin(this.moonOrbitAngle)
      );
    }
    this.physicsManager.setKinematicTarget(this.moonMesh, this.moonMesh.position, this.moonMesh.quaternion);

    if (this.earthshineLight && this.earthMesh && earthVisible) {
      this.earthshineLight.position.copy(this.earthMesh.position);
      this.earthshineLight.target.position.copy(this.moonMesh.position);
      this.earthshineLight.target.updateMatrixWorld();
    }

    this.updateLunarDust();
  }

  private updateLunarDust() {
    if (!this.lunarDust || !this.lunarDustActive) {
      return;
    }

    this.lunarDustTimer += 0.016;
    const dustPositions = this.lunarDust.geometry.attributes['position'] as THREE.BufferAttribute;
    for (let index = 0; index < this.lunarDustLife.length; index++) {
      if (this.lunarDustLife[index] <= 0) {
        continue;
      }

      this.lunarDustLife[index] -= 0.016;
      this.lunarDustVelocities[index * 3 + 1] -= 0.00001;
      dustPositions.setXYZ(
        index,
        dustPositions.getX(index) + this.lunarDustVelocities[index * 3],
        Math.max(0, dustPositions.getY(index) + this.lunarDustVelocities[index * 3 + 1]),
        dustPositions.getZ(index) + this.lunarDustVelocities[index * 3 + 2]
      );
    }
    dustPositions.needsUpdate = true;
    if (this.lunarDustTimer > 4) {
      this.lunarDustActive = false;
    }
  }

  private updateImmersiveSceneEffects(deltaTime: number, time: number) {
    this.updateMoons(time);
    this.updateSpaceships(time);
    this.updateStarsAndDust(time);
    this.updateShootingStars();
    this.updateComet();
    this.updateDeathStar(time);
    this.updateBlackHole(time);
    this.updateHyperspace(deltaTime, time);
  }

  private updateSecondaryBodyAnimation(time: number) {
    if (this.saturnGroup) {
      this.saturnGroup.rotation.y += 0.0002;
    }
    if (!this.hyperspaceActive && this.stars && this.stars.scale.z !== 1) {
      this.stars.scale.set(1, 1, 1);
    }
    if (this.marsMesh) {
      this.marsMesh.rotation.y += 0.003;
    }
    this.updateStarmanAnimation();
    this.updateFloatingAstronaut();
    if (this.venusMesh) this.venusMesh.rotation.y -= 0.0003;
    if (this.mercuryMesh) this.mercuryMesh.rotation.y += 0.001;
    if (this.uranusMesh) this.uranusMesh.rotation.y += 0.0004;
    if (this.neptuneMesh) this.neptuneMesh.rotation.y += 0.0004;
    if (this.earthCloudsMesh) this.earthCloudsMesh.rotation.y += 0.0006;

    if (this.auroraTop) {
      (this.auroraTop.material as THREE.ShaderMaterial).uniforms['uTime'].value = time;
    }
    if (this.auroraBottom) {
      (this.auroraBottom.material as THREE.ShaderMaterial).uniforms['uTime'].value = time + 5;
    }

    this.updateLightning();
    if (this.ioPlasmaTorusMesh) {
      (this.ioPlasmaTorusMesh.material as THREE.ShaderMaterial).uniforms['uTime'].value = time;
    }
    this.updateEuropaPlumes(time);
    this.updateSolarWind();
    this.updateAsbjornMeteorStorm(time);
    if (this.radiationBelt) {
      (this.radiationBelt.material as THREE.ShaderMaterial).uniforms['uTime'].value = time;
    }
  }

  private updateStarmanAnimation() {
    if (!this.starmanGroup) {
      return;
    }

    const showStarman = this.tourActive && (
      this.activeCameraAnchorKey === 'aarde' ||
      this.activeCameraAnchorKey === 'maan' ||
      this.activeCameraAnchorKey === 'mars' ||
      this.activeCameraAnchorKey === 'starman'
    );
    const earthVisible = this.earthMesh?.visible ?? false;
    this.starmanGroup.visible = showStarman || earthVisible;
    if (!this.starmanGroup.visible || !this.earthMesh) {
      return;
    }

    this.starmanOrbitAngle += 0.0008;
    const earthPosition = this.earthMesh.position;
    const orbitRadius = 1.65;
    const cameraDir = this.camera.position.clone().sub(earthPosition).normalize();
    const lateral = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), cameraDir).normalize();
    if (lateral.lengthSq() < 1e-4) {
      lateral.set(1, 0, 0);
    }
    const phase = this.starmanOrbitAngle;
    const frontOffset = orbitRadius * (1.2 + Math.cos(phase) * 0.18);
    const sideOffset = orbitRadius * Math.sin(phase) * 0.35;
    this.starmanGroup.position.set(
      earthPosition.x + cameraDir.x * frontOffset + lateral.x * sideOffset,
      earthPosition.y + 0.45 * Math.sin(this.starmanOrbitAngle * 0.7) + 0.2,
      earthPosition.z + cameraDir.z * frontOffset + lateral.z * sideOffset
    );
    this.starmanGroup.rotation.x += 0.003;
    this.starmanGroup.rotation.z += 0.001;
    this.starmanGroup.rotation.y += 0.002;
  }

  private updateFloatingAstronaut() {
    if (!this.astronautGroup || !this.starmanGroup?.visible) {
      if (this.astronautGroup) this.astronautGroup.visible = false;
      return;
    }
    this.astronautGroup.visible = this.starmanGroup.visible;
    if (!this.astronautGroup.visible) return;

    // Orbit near the Tesla at a slight offset — as if floating alongside
    const offset = new THREE.Vector3(0.5, 0.3, -0.4);
    this.astronautGroup.position.copy(this.starmanGroup.position).add(offset);

    // Gentle tumble in zero-g
    this.astronautGroup.rotation.x += 0.002;
    this.astronautGroup.rotation.y += 0.003;
    this.astronautGroup.rotation.z += 0.001;
  }

  private updateColumbiaSequence(deltaTime: number) {
    if (!this.columbiaSequenceActive || !this.columbiaGroup) return;

    this.columbiaSequenceTime += deltaTime;
    const t = this.columbiaSequenceTime;

    // ─── Phase 1 (0-4s): Shuttle flying with re-entry plasma trail ────
    if (t < 4) {
      if (this.columbiaShuttleMesh) {
        this.columbiaShuttleMesh.visible = true;
        // Shuttle moves forward
        this.columbiaShuttleMesh.position.x = t * 1.1;
        // Slight nose-up re-entry attitude
        this.columbiaShuttleMesh.rotation.z = -0.15;
        this.columbiaShuttleMesh.rotation.x = Math.sin(t * 0.5) * 0.02;
      }
      if (this.columbiaTrails) {
        const mat = this.columbiaTrails.material as THREE.ShaderMaterial;
        mat.uniforms['uTime'].value = t;
        mat.uniforms['uIntensity'].value = Math.min(t / 1.5, 1.0);
        this.columbiaTrails.position.x = (this.columbiaShuttleMesh?.position.x ?? 0) - 2;
      }
    }

    // ─── Phase 2 (4-5s): Structural breakup — flash + shuttle disappears ─
    if (t >= 4 && !this.columbiaBreakupDone) {
      this.columbiaBreakupDone = true;

      // Flash
      if (this.columbiaFlashLight) {
        this.columbiaFlashLight.intensity = 30;
        this.columbiaFlashLight.position.copy(this.columbiaShuttleMesh?.position ?? new THREE.Vector3());
      }

      // Hide intact shuttle, show debris
      if (this.columbiaShuttleMesh) this.columbiaShuttleMesh.visible = false;
      if (this.columbiaDebris) {
        this.columbiaDebris.visible = true;
        this.columbiaDebris.position.copy(this.columbiaShuttleMesh?.position ?? new THREE.Vector3());
      }
    }

    // ─── Phase 3 (4-10s): Debris scatters, flash fades ─────────────────
    if (t >= 4 && t < 10) {
      // Flash decay
      if (this.columbiaFlashLight) {
        this.columbiaFlashLight.intensity *= 0.92;
      }

      // Trail fades
      if (this.columbiaTrails) {
        const mat = this.columbiaTrails.material as THREE.ShaderMaterial;
        mat.uniforms['uIntensity'].value = Math.max(0, 1.0 - (t - 4) / 3);
      }

      // Debris expansion
      if (this.columbiaDebris) {
        const count = this.columbiaDebris.count;
        const dm = new THREE.Object3D();
        const matrix = new THREE.Matrix4();
        const dt = deltaTime;
        for (let i = 0; i < count; i++) {
          this.columbiaDebris.getMatrixAt(i, matrix);
          dm.position.setFromMatrixPosition(matrix);
          dm.position.x += this.columbiaDebrisVelocities[i * 3] * dt * 3;
          dm.position.y += this.columbiaDebrisVelocities[i * 3 + 1] * dt * 3;
          dm.position.z += this.columbiaDebrisVelocities[i * 3 + 2] * dt * 3;
          dm.rotation.x += dt * (this.columbiaDebrisVelocities[i * 3] * 2);
          dm.rotation.y += dt * (this.columbiaDebrisVelocities[i * 3 + 1] * 2);
          dm.scale.setFromMatrixScale(matrix);
          dm.updateMatrix();
          this.columbiaDebris.setMatrixAt(i, dm.matrix);
        }
        this.columbiaDebris.instanceMatrix.needsUpdate = true;
      }
    }

    // ─── Phase 4 (8-14s): Seven stars rise — one for each crew member ──
    if (t >= 8) {
      if (this.columbiaMemorialStars) {
        const starOpacity = Math.min((t - 8) / 4, 1.0);
        (this.columbiaMemorialStars.material as THREE.ShaderMaterial).uniforms['uOpacity'].value = starOpacity;
      }
      // Debris fades
      if (this.columbiaDebris && t > 10) {
        this.columbiaDebris.visible = false;
      }
    }
  }

  private updateSimulationStep(time: number) {
    this.physicsManager.step(time);
    this.updateCustomFrustumCulling();
    this.maybeShiftFloatingOrigin();
  }

  private updateSunAnimation(time: number) {
    if (!this.sunMesh) {
      return;
    }

    const sunShader = this.sunMesh.material as THREE.ShaderMaterial;
    if (sunShader.uniforms) sunShader.uniforms['uTime'].value = time;

    const chromosphere = this.sunMesh.children[0] as THREE.Mesh | undefined;
    if (chromosphere) {
      const chromoMat = chromosphere.material as THREE.ShaderMaterial;
      if (chromoMat.uniforms) chromoMat.uniforms['uTime'].value = time;
    }

    const coronaInner = this.sunMesh.children[1] as THREE.Mesh | undefined;
    if (coronaInner) {
      const innerMaterial = coronaInner.material as THREE.ShaderMaterial;
      if (innerMaterial.uniforms) innerMaterial.uniforms['uTime'].value = time;
      const innerScale = 1 + Math.sin(time * 0.4) * 0.03 + Math.sin(time * 0.17) * 0.015;
      coronaInner.scale.set(innerScale, innerScale, innerScale);
      coronaInner.rotation.y = time * 0.02;
    }

    const coronaOuter = this.sunMesh.children[2] as THREE.Mesh | undefined;
    if (coronaOuter) {
      const outerMaterial = coronaOuter.material as THREE.ShaderMaterial;
      if (outerMaterial.uniforms) outerMaterial.uniforms['uTime'].value = time;
      const outerScale = 1 + Math.sin(time * 0.25) * 0.04;
      coronaOuter.scale.set(outerScale, outerScale, outerScale);
    }

    this.sunMesh.rotation.y = time * 0.01;
  }

  private onWindowResize() {
    if (this.camera && this.renderer) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postProcessManager?.setSize(window.innerWidth, window.innerHeight);
    }
  }
}
