import { Effect } from 'postprocessing';
import { Uniform } from 'three';

const fragmentShader = /* glsl */ `
  uniform float uTime;

  float random(vec2 p) {
    return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 center = uv - 0.5;
    float dist = length(center);

    // Very soft vignette — barely darkens the far corners
    float vignette = smoothstep(1.3, 0.35, dist * 1.0);

    vec4 color = inputColor;

    // Apply subtle vignette only
    outputColor = vec4(color.rgb * vignette, color.a);
  }
`;

export class CinematicGradingEffect extends Effect {
  constructor() {
    super('CinematicGradingEffect', fragmentShader, {
      uniforms: new Map([['uTime', new Uniform(0)]]),
    });
  }

  override update(_renderer: unknown, _inputBuffer: unknown, deltaTime: number): void {
    const uniform = this.uniforms.get('uTime');
    if (uniform) {
      (uniform as { value: number }).value += deltaTime;
    }
  }
}
