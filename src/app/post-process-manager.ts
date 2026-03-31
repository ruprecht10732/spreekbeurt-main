import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
} from 'postprocessing';
import { CinematicGradingEffect } from './cinematic-grading-effect';

export class PostProcessManager {
  private readonly composer: EffectComposer;
  private readonly bloomEffect: BloomEffect;
  private readonly renderPass: RenderPass;
  private readonly effectPass: EffectPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    lightSource?: THREE.Mesh | THREE.Points,
  ) {
    this.composer = new EffectComposer(renderer, {
      // CRITICAL FOR CPU: 8-bit framebuffer. 16-bit HalfFloat causes massive bandwidth bottlenecks on integrated graphics.
      frameBufferType: THREE.UnsignedByteType,
      multisampling: Math.min(4, renderer.capabilities.maxSamples)
    });

    this.renderPass = new RenderPass(scene, camera);

    // Optimized Bloom for CPU
    this.bloomEffect = new BloomEffect({
      blendFunction: BlendFunction.SCREEN,
      intensity: 0.9,
      luminanceThreshold: 0.95,
      luminanceSmoothing: 0.15,
      mipmapBlur: false, // Saves huge CPU overhead
      radius: 0.58,
      resolutionScale: 0.5 // Computes bloom at half-resolution to save framerate
    });

    // Cinematic grading (vignette + film grain + color grading)
    const gradingEffect = new CinematicGradingEffect();

    this.effectPass = new EffectPass(camera, this.bloomEffect, gradingEffect);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.effectPass);
  }

  setBloomIntensity(intensity: number): void {
    this.bloomEffect.intensity = intensity;
  }

  getBloomIntensity(): number {
    return this.bloomEffect.intensity;
  }

  setDofFocusDistance(worldDistance: number, camera: THREE.PerspectiveCamera): void {
    // Removed DepthOfField to save CPU - No-op
  }

  setChromaticAberrationOffset(x: number, y: number): void {
    // Removed ChromaticAberration to save CPU - No-op
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