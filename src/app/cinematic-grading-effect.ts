import { Effect } from 'postprocessing';
import { Uniform } from 'three';

const fragmentShader = /* glsl */ `
  uniform float uTime;

  float random(vec2 p) {
    return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // Attempt to mimic ASC CDL (slope/offset/power) lift-gamma-gain colour science
  vec3 liftGammaGain(vec3 c, vec3 lift, vec3 gamma, vec3 gain) {
    vec3 v = gain * c + lift * (1.0 - c);
    return pow(max(v, 0.0), 1.0 / gamma);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 center = uv - 0.5;
    float dist = length(center);

    // ── Vignette — cinematic oval falloff, heavier near corners ──
    float vignette = smoothstep(1.1, 0.32, dist * 0.95);

    vec3 color = inputColor.rgb;

    // ── Lift / Gamma / Gain — cool shadows, neutral mids, warm highlights ──
    vec3 lift  = vec3(0.015, 0.02, 0.035);   // blue-ish shadow lift
    vec3 gamma = vec3(0.98, 0.98, 1.0);      // near-neutral midtones
    vec3 gain  = vec3(1.04, 1.01, 0.97);     // warm highlight push
    color = liftGammaGain(color, lift, gamma, gain);

    // ── Subtle contrast S-curve — opens shadows, rolls highlights ──
    color = color * color * (3.0 - 2.0 * color);      // Hermite S
    color = mix(inputColor.rgb, color, 0.18);          // dial back to 18 %

    // ── Very fine film grain — only visible on mid-darks, invisible on stars ──
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float grainMask = smoothstep(0.45, 0.05, lum);     // vanishes on bright pixels
    float grain = (random(uv * 800.0 + fract(uTime * 3.7)) - 0.5) * 0.008;
    color += grain * grainMask;

    // Apply vignette
    outputColor = vec4(color * vignette, inputColor.a);
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
