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

    // Soft cinematic vignette — wide falloff for natural look
    float vignette = smoothstep(1.1, 0.25, dist * 1.1);

    // Fine organic film grain (subtle, not distracting)
    float grain = (random(uv * 800.0 + mod(uTime, 10.0)) - 0.5) * 0.025;

    // Subtle anamorphic horizontal streak
    float streak = smoothstep(0.5, 0.0, abs(center.y)) * smoothstep(0.6, 0.3, abs(center.x)) * 0.012;

    vec4 color = inputColor;

    // Cinematic color grading: warm highlights, cool shadows
    color.r += dist * 0.025;
    color.g += dist * 0.008;
    color.b += dist * 0.035;

    // Film grain
    color.rgb += grain;

    // Apply vignette and streak
    outputColor = vec4(color.rgb * vignette, max(color.a - streak, 0.0));
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
