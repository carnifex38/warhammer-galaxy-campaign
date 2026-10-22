/** 3D value noise and fractal noise for planet shaders. */
export const NOISE3 = /* glsl */ `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm3d(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { v += a * noise3(p); p = p * 2.02 + 11.3; a *= 0.5; }
    return v;
  }
`

/**
 * The same noise, but the octave loop runs to a uniform instead of a constant. A graphics driver unrolls a constant loop, so the
 * planet shaders (dozens of these calls each) become enormous programs that take seconds to compile. With a real loop the program
 * stays small. Slightly slower to run, which does not matter for the one-off baking of a planet's surface.
 */
export const NOISE3_LOOP = NOISE3.replace(
  'for (int i = 0; i < 6; i++)',
  'for (int i = 0; i < uOct; i++)',
).replace('float hash3(', 'uniform int uOct;\n  float hash3(')
