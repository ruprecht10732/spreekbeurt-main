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
  @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef<HTMLDivElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private jupiterGroup!: THREE.Group;
  private jupiter!: THREE.Mesh;
  private atmosphere!: THREE.Mesh;
  
  // 95 Moons: 4 Galilean + 91 small moons
  private galileanMoons: { mesh: THREE.Mesh, distance: number, speed: number, angle: number }[] = [];
  private smallMoons!: THREE.InstancedMesh;
  private smallMoonsData: { distance: number, speed: number, angle: number, inclination: number }[] = [];
  
  private stars!: THREE.Points;
  private dustSystem!: THREE.Points;
  private animationFrameId: number | null = null;
  private isBrowser: boolean;
  private clock = new THREE.Clock();
  
  // Camera transition targets
  private targetCameraX = 0;
  private targetCameraY = 0;
  private targetCameraZ = 45;
  private baseCameraX = 0;
  private baseCameraY = 0;
  private baseCameraZ = 45;
  private targetLookAt = new THREE.Vector3(0, 0, 0);
  private currentLookAt = new THREE.Vector3(0, 0, 0);
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

  private ngZone = inject(NgZone);
  private platformId = inject(PLATFORM_ID);
  
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
    if (this.earthMesh) this.earthMesh.visible = false; // Hide earth by default

    switch(id) {
      case 'title':
      case 'afsluiting':
        // Majestic wide shot
        this.baseCameraX = 0; this.baseCameraY = 0; this.baseCameraZ = 45;
        this.targetLookAt.set(0, 0, 0);
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
        // The Great Red Spot - Close up, angled towards southern hemisphere
        this.baseCameraX = 0; this.baseCameraY = -3; this.baseCameraZ = 14;
        this.targetLookAt.set(0, -2, 0);
        this.targetJupiterRotationY = 4.7; // Rotate planet so the Red Spot faces the camera perfectly
        break;
      case 'h3':
        // Distance - Warp speed effect
        this.baseCameraX = 30; this.baseCameraY = 15; this.baseCameraZ = 5;
        this.targetLookAt.set(0, 0, 0);
        this.targetStarSpeed = 0.25; // Much faster stars for warp speed
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
      window.addEventListener('resize', this.onWindowResize.bind(this));
      window.addEventListener('mousemove', this.onMouseMove.bind(this));
    }
  }

  ngOnDestroy() {
    if (this.isBrowser) {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
      }
      window.removeEventListener('resize', this.onWindowResize.bind(this));
      window.removeEventListener('mousemove', this.onMouseMove.bind(this));
      if (this.renderer) {
        this.renderer.dispose();
      }
    }
  }

  private onMouseMove(event: MouseEvent) {
    this.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
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

    // Stars (More dynamic starfield)
    const starsGeometry = new THREE.BufferGeometry();
    const starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.15,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true
    });

    const starsVertices = [];
    for (let i = 0; i < 15000; i++) {
      const x = THREE.MathUtils.randFloatSpread(2000);
      const y = THREE.MathUtils.randFloatSpread(2000);
      const z = THREE.MathUtils.randFloatSpread(2000);
      starsVertices.push(x, y, z);
    }

    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
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

    // Group for Jupiter and Atmosphere
    this.jupiterGroup = new THREE.Group();
    this.jupiterGroup.position.set(12, 0, -15);
    this.jupiterGroup.rotation.z = 0.05; // Slight tilt
    this.scene.add(this.jupiterGroup);

    // Jupiter Texture Generation (Procedural Fallback)
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (context) {
      // Base color
      context.fillStyle = '#c99b65';
      context.fillRect(0, 0, 2048, 1024);
      
      // Draw many fine bands with turbulence
      for (let i = 0; i < 1500; i++) {
        const y = Math.random() * 1024;
        const h = Math.random() * 15 + 2;
        const opacity = Math.random() * 0.4;
        
        // Color palette based on latitude
        const lat = Math.abs((y / 1024) - 0.5) * 2.0; // 0 at equator, 1 at poles
        let r, g, b;
        if (lat < 0.15) { // Equatorial Zone (White/Light)
           r = 230 + Math.random() * 25; g = 220 + Math.random() * 25; b = 210 + Math.random() * 25;
        } else if (lat < 0.3) { // Equatorial Belts (Dark Brown/Red)
           r = 160 + Math.random() * 40; g = 90 + Math.random() * 30; b = 50 + Math.random() * 20;
        } else if (lat < 0.5) { // Tropical Zones (Lighter)
           r = 210 + Math.random() * 30; g = 190 + Math.random() * 30; b = 160 + Math.random() * 30;
        } else if (lat < 0.7) { // Temperate Belts (Brown/Orange)
           r = 180 + Math.random() * 30; g = 120 + Math.random() * 30; b = 80 + Math.random() * 20;
        } else { // Polar Regions (Grey/Blueish/Brown)
           r = 140 + Math.random() * 30; g = 140 + Math.random() * 30; b = 130 + Math.random() * 30;
        }
        
        context.fillStyle = `rgba(${r},${g},${b},${opacity})`;
        
        context.beginPath();
        context.moveTo(0, y);
        for(let x = 0; x <= 2048; x += 20) {
           const wave1 = Math.sin(x * 0.01 + y * 0.05) * 10;
           const wave2 = Math.cos(x * 0.03 - y * 0.02) * 5;
           context.lineTo(x, y + wave1 + wave2);
        }
        context.lineTo(2048, y + h);
        context.lineTo(0, y + h);
        context.fill();
      }
      
      // Draw the Great Red Spot with gradient
      const grsX = 1200;
      const grsY = 650;
      const gradient = context.createRadialGradient(grsX, grsY, 10, grsX, grsY, 120);
      gradient.addColorStop(0, 'rgba(200, 70, 40, 1)');
      gradient.addColorStop(0.4, 'rgba(220, 100, 60, 0.9)');
      gradient.addColorStop(0.8, 'rgba(180, 80, 50, 0.6)');
      gradient.addColorStop(1, 'rgba(180, 80, 50, 0)');
      
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(grsX, grsY, 180, 90, 0, 0, Math.PI * 2);
      context.fill();
      
      // Swirling around the red spot
      context.lineWidth = 3;
      for(let i=0; i<12; i++) {
        context.strokeStyle = `rgba(230, 180, 130, ${0.5 - i*0.04})`;
        context.beginPath();
        context.ellipse(grsX, grsY, 190 + i*12, 100 + i*6, 0, 0, Math.PI * 2);
        context.stroke();
      }
    }
    
    const fallbackTexture = new THREE.CanvasTexture(canvas);
    if ('SRGBColorSpace' in THREE) {
      fallbackTexture.colorSpace = (THREE as unknown as { SRGBColorSpace: THREE.ColorSpace }).SRGBColorSpace;
    }
    fallbackTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    
    const jupiterGeometry = new THREE.SphereGeometry(10, 256, 256);
    const jupiterMaterial = new THREE.MeshStandardMaterial({ 
      map: fallbackTexture,
      roughness: 0.4, // Gas giants are relatively smooth but scatter light
      metalness: 0.0
    });

    // Subtle Cinematic Enhancement (Removed aggressive contrast that crushed details)
    jupiterMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <map_fragment>`,
        `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          
          // Subtle enhancement of the Great Red Spot
          float redDominance = max(0.0, sampledDiffuseColor.r - max(sampledDiffuseColor.g, sampledDiffuseColor.b) * 0.9);
          sampledDiffuseColor.r += redDominance * 0.3; 
          
          // Very slight contrast boost to keep details crisp
          sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, smoothstep(0.0, 1.0, sampledDiffuseColor.rgb), 0.2);

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

    // Load Ultra High-Res Equirectangular Texture (8K/4K)
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous');
    
    // Using a highly detailed 4K Jupiter map from Wikimedia Commons
    textureLoader.load(
      'https://upload.wikimedia.org/wikipedia/commons/e/e2/Jupiter.jpg',
      (texture) => {
        if ('SRGBColorSpace' in THREE) {
          texture.colorSpace = (THREE as unknown as { SRGBColorSpace: THREE.ColorSpace }).SRGBColorSpace;
        }
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        
        jupiterMaterial.map = texture;
        // Removed bumpMap as using diffuse for bump on a gas giant creates unnatural noise and ruins crispness
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

    // Load Earth Texture
    textureLoader.load(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Earth_map_1000x500.jpg/1024px-Earth_map_1000x500.jpg',
      (texture) => {
        if ('SRGBColorSpace' in THREE) {
          texture.colorSpace = (THREE as unknown as { SRGBColorSpace: THREE.ColorSpace }).SRGBColorSpace;
        }
        earthMaterial.map = texture;
        earthMaterial.color.setHex(0xffffff); // Reset base color when texture loads
        earthMaterial.needsUpdate = true;
      },
      undefined,
      (err) => console.warn('Could not load Earth texture.', err)
    );

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
    const sunLight = new THREE.DirectionalLight(0xffeedd, 4.0);
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
          float vignette = smoothstep(0.9, 0.25, dist * 1.2);
          float grain = (random(vUv + mod(uTime, 10.0)) - 0.5) * 0.07;
          vec4 overlayColor = vec4(0.0, 0.0, 0.0, 1.0 - vignette);
          overlayColor.rgb += grain;
          overlayColor.a += abs(grain) * 0.5;
          gl_FragColor = overlayColor;
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));
  }

  private animate() {
    this.animationFrameId = requestAnimationFrame(() => this.animate());

    const time = this.clock.getElapsedTime();

    // Lerp contextual animation values
    this.currentStarSpeed += (this.targetStarSpeed - this.currentStarSpeed) * 0.02;
    this.currentMoonSpeedMultiplier += (this.targetMoonSpeedMultiplier - this.currentMoonSpeedMultiplier) * 0.02;
    this.currentAtmospherePulse += (this.targetAtmospherePulse - this.currentAtmospherePulse) * 0.05;
    this.currentJupiterSpinSpeed += (this.targetJupiterSpinSpeed - this.currentJupiterSpinSpeed) * 0.02;

    // Atmosphere pulsing (Gas giant slide)
    if (this.atmosphere) {
      const pulseScale = 1.0 + Math.sin(time * 3) * 0.03 * this.currentAtmospherePulse;
      this.atmosphere.scale.set(pulseScale, pulseScale, pulseScale);
      
      const mat = this.atmosphere.material as THREE.ShaderMaterial;
      if (mat.uniforms) {
        mat.uniforms['uTime'].value = time;
        mat.uniforms['uPulse'].value = this.currentAtmospherePulse;
      }
    }

    // Smooth camera transition with mouse parallax
    if (this.camera) {
      this.targetCameraX = this.baseCameraX + this.mouseX * 4;
      this.targetCameraY = this.baseCameraY + this.mouseY * 4;
      this.targetCameraZ = this.baseCameraZ;

      // Smoother dampening for cinematic parallax
      this.camera.position.x += (this.targetCameraX - this.camera.position.x) * 0.02;
      this.camera.position.y += (this.targetCameraY - this.camera.position.y) * 0.02;
      this.camera.position.z += (this.targetCameraZ - this.camera.position.z) * 0.02;
      
      this.currentLookAt.lerp(this.targetLookAt, 0.02);
      this.camera.lookAt(this.currentLookAt);
    }

    // Rotate Jupiter slowly to show different sides, or target the Red Spot
    if (this.jupiterGroup) {
      if (this.targetJupiterRotationY !== null) {
        // Lerp to the target rotation (shortest path)
        const diff = this.targetJupiterRotationY - this.jupiterGroup.rotation.y;
        const normalizedDiff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.jupiterGroup.rotation.y += normalizedDiff * 0.02;
      } else {
        // Normal slow rotation or dynamic fast spin
        this.jupiterGroup.rotation.y += this.currentJupiterSpinSpeed;
      }
    }

    // Rotate Earth if visible
    if (this.earthMesh && this.earthMesh.visible) {
      this.earthMesh.rotation.y += 0.005;
    }

    // Animate Galilean Moons
    this.galileanMoons.forEach(moon => {
      moon.angle += moon.speed * this.currentMoonSpeedMultiplier;
      moon.mesh.position.x = Math.cos(moon.angle) * moon.distance;
      moon.mesh.position.z = Math.sin(moon.angle) * moon.distance;
      moon.mesh.rotation.y += 0.01 * this.currentMoonSpeedMultiplier;
    });

    // Animate 91 Small Moons
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

    // Slowly move stars (or fast for warp speed)
    if (this.stars) {
      this.stars.rotation.y += this.currentStarSpeed;
      this.stars.rotation.x += this.currentStarSpeed * 0.5;
    }

    // Rotate dust slowly, and move along Z for warp effect
    if (this.dustSystem) {
      this.dustSystem.rotation.y += this.currentStarSpeed * 3;
      this.dustSystem.rotation.x += this.currentStarSpeed;
      
      if (this.currentStarSpeed > 0.001) {
        const positions = this.dustSystem.geometry.attributes['position'] as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) {
          let z = positions.getZ(i);
          z += this.currentStarSpeed * 300; // Move towards camera much faster
          if (z > 50) z -= 100; // Wrap around
          positions.setZ(i, z);
        }
        positions.needsUpdate = true;
      }
    }

    if (this.postMaterial) {
      this.postMaterial.uniforms['uTime'].value = time;
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
