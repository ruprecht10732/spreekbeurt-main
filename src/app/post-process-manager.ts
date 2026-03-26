import * as THREE from 'three';
import {
  BlendFunction,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  KernelSize,
  NormalPass,
  RenderPass,
  SelectiveBloomEffect,
  SMAAEffect,
  SMAAPreset,
  SSAOEffect,
  VignetteEffect,
} from 'postprocessing';

export const BLOOM_LAYER = 11;

export class PostProcessManager {
  private readonly composer: EffectComposer;
  private readonly bloomEffect: SelectiveBloomEffect;
  private readonly renderPass: RenderPass;
  private readonly effectPass: EffectPass;
  private readonly godRaysEffect: GodRaysEffect | null;

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
    this.bloomEffect = new SelectiveBloomEffect(scene, camera, {
      blendFunction: BlendFunction.SCREEN,
      intensity: 1.6,
      luminanceThreshold: 0.28,
      luminanceSmoothing: 0.12,
      mipmapBlur: true,
      radius: 0.74,
    });
    this.bloomEffect.selection.layer = BLOOM_LAYER;
    this.bloomEffect.ignoreBackground = false;

    this.godRaysEffect = lightSource ? new GodRaysEffect(camera, lightSource, {
      blendFunction: BlendFunction.SCREEN,
      samples: 96,
      density: 0.84,
      decay: 0.95,
      weight: 0.22,
      exposure: 0.22,
      clampMax: 1,
      kernelSize: KernelSize.MEDIUM,
      blur: true,
    }) : null;

    const vignette = new VignetteEffect({
      eskil: false,
      darkness: 0.38,
      offset: 0.22,
    });

    const chromaticAberration = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.0006, 0.0006),
      radialModulation: true,
      modulationOffset: 0.3,
    });

    // SMAA — anti-aliasing to clean up thin geometry (lightsaber blades, ring edges)
    const smaaEffect = new SMAAEffect({ preset: SMAAPreset.HIGH });

    // SSAO — screen-space ambient occlusion for contact shadows
    const normalPass = new NormalPass(scene, camera);
    const ssaoEffect = new SSAOEffect(camera, normalPass.texture, {
      blendFunction: BlendFunction.MULTIPLY,
      samples: 16,
      rings: 4,
      luminanceInfluence: 0.6,
      radius: 0.04,
      intensity: 1.5,
      bias: 0.025,
    });

    const effects = this.godRaysEffect
      ? [this.bloomEffect, this.godRaysEffect, ssaoEffect, smaaEffect, vignette]
      : [this.bloomEffect, ssaoEffect, smaaEffect, vignette];

    this.effectPass = new EffectPass(camera, ...effects);

    // ChromaticAberration is a convolution effect — it must live in its own pass
    const chromaPass = new EffectPass(camera, chromaticAberration);
    chromaPass.renderToScreen = true;

    this.composer.addPass(this.renderPass);
    this.composer.addPass(normalPass);
    this.composer.addPass(this.effectPass);
    this.composer.addPass(chromaPass);
  }

  addBloomSelection(object: THREE.Object3D): void {
    object.layers.enable(BLOOM_LAYER);
    this.bloomEffect.selection.add(object);
  }

  addBloomSelectionRecursive(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        this.addBloomSelection(child);
      }
    });
  }

  setBloomIntensity(intensity: number): void {
    this.bloomEffect.intensity = intensity;
  }

  getBloomIntensity(): number {
    return this.bloomEffect.intensity;
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