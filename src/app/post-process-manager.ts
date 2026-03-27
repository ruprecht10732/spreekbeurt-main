import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  KernelSize,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
} from 'postprocessing';
import { CinematicGradingEffect } from './cinematic-grading-effect';

export class PostProcessManager {
  private readonly composer: EffectComposer;
  private readonly bloomEffect: BloomEffect;
  private readonly renderPass: RenderPass;
  private readonly effectPass: EffectPass;
  private readonly godRaysEffect: GodRaysEffect | null;
  private readonly chromaticAberrationEffect: ChromaticAberrationEffect;
  private readonly dofEffect: DepthOfFieldEffect;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    lightSource?: THREE.Mesh | THREE.Points,
  ) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
    });

    this.renderPass = new RenderPass(scene, camera);

    // Bloom tuned for cinematic space — catches atmospheric glows, star PSFs, and hero lights
    this.bloomEffect = new BloomEffect({
      blendFunction: BlendFunction.SCREEN,
      intensity: 1.35,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.15,
      mipmapBlur: true,
      radius: 0.7,
    });

    this.godRaysEffect = lightSource ? new GodRaysEffect(camera, lightSource, {
      blendFunction: BlendFunction.SCREEN,
      samples: 48,
      density: 0.86,
      decay: 0.94,
      weight: 0.28,
      exposure: 0.26,
      clampMax: 1,
      kernelSize: KernelSize.LARGE,
      blur: true,
    }) : null;

    const chromaticAberration = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.00003, 0.00003),
      radialModulation: true,
      modulationOffset: 0.6,
    });
    this.chromaticAberrationEffect = chromaticAberration;

    // Cinematic Depth of Field — gentle bokeh on extreme foreground/background
    this.dofEffect = new DepthOfFieldEffect(camera, {
      focusDistance: 0,
      focalLength: 0.025,
      bokehScale: 1.2,
    });

    // SMAA — image-space anti-aliasing (compatible with logarithmic depth buffer)
    const smaaEffect = new SMAAEffect({ preset: SMAAPreset.ULTRA });

    // Cinematic grading (vignette + film grain + color grading) merged into single effect
    const gradingEffect = new CinematicGradingEffect();

    // Main effect pass — all non-convolution effects merged together
    const effects: Array<InstanceType<typeof BloomEffect> | InstanceType<typeof GodRaysEffect> | InstanceType<typeof DepthOfFieldEffect> | InstanceType<typeof SMAAEffect> | CinematicGradingEffect> = [];
    if (this.godRaysEffect) effects.push(this.godRaysEffect);
    effects.push(this.bloomEffect, this.dofEffect, smaaEffect, gradingEffect);

    this.effectPass = new EffectPass(camera, ...effects);

    // ChromaticAberration is a convolution effect — needs its own pass
    const chromaticPass = new EffectPass(camera, chromaticAberration);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.effectPass);
    this.composer.addPass(chromaticPass);
  }

  setBloomIntensity(intensity: number): void {
    this.bloomEffect.intensity = intensity;
  }

  getBloomIntensity(): number {
    return this.bloomEffect.intensity;
  }

  setDofFocusDistance(distance: number): void {
    this.dofEffect.cocMaterial.uniforms['focusDistance'].value = distance;
  }

  setChromaticAberrationOffset(x: number, y: number): void {
    this.chromaticAberrationEffect.offset = new THREE.Vector2(x, y);
  }

  render(deltaTime: number): void {
    this.composer.render(deltaTime);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  dispose(): void {
    this.composer.dispose();
  }
}