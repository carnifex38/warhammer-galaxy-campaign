import { NOISE3 } from './glsl'
export const PLANET_VERT = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWN;
  varying vec3 vWP;
  void main() {
    vObj = normalize(position);
    vWN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

/**
 * The planet surface shader: real crater fields, ridged channels and relief, soft marbled
 * clouds, a gently wrapped terminator, and atmospheric haze that lightens the planet toward its edge.
 */
export const REAL_FRAG = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWN;
  varying vec3 vWP;
  uniform float uTime, uSea, uIce, uCloud, uCity, uLava, uCrack, uScale, uSeed, uHaze, uCraters, uAmbient, uGrid;
  uniform vec3 uDeep, uShallow, uLandA, uLandB, uCloudCol, uAtmo, uLight;
  uniform mat3 uModelRot;
  uniform int uCells;
  ${NOISE3}

  // impact craters: a bowl with a raised rim, in two sizes, scattered over the sphere
  float craterField(vec3 p) {
    float h = 0.0;
    for (int k = 0; k < 2; k++) {
      float sc = k == 0 ? 6.0 : 15.0;
      vec3 x = p * sc + uSeed * 1.3 + float(k) * 17.0;
      vec3 ip = floor(x);
      vec3 fp = fract(x);
      for (int n = 0; n < uCells; n++) { int i = n % 3 - 1; int j = (n / 3) % 3 - 1; int l = n / 9 - 1;
        vec3 g = vec3(float(i), float(j), float(l));
        vec3 c = vec3(hash3(ip + g), hash3(ip + g + 19.1), hash3(ip + g + 37.7));
        float present = step(0.6, hash3(ip + g + 53.3));
        float r = 0.16 + 0.2 * hash3(ip + g + 71.9);
        float d = length(g + c - fp) / r;
        float bowl = -(1.0 - smoothstep(0.0, 1.0, d)) * 0.6;
        float rim = exp(-pow((d - 1.0) * 4.0, 2.0)) * 0.35;
        h += present * (bowl + rim) * (k == 0 ? 1.0 : 0.55);
      }
    }
    return h;
  }

  // glowing networks of roads and ring-shaped structures across a built-over world
  float gridGlow(vec3 p) {
    float n = fbm3d(p * 26.0 + uSeed);
    float lines = pow(clamp(1.0 - abs(n - 0.5) * 14.0, 0.0, 1.0), 2.0);
    vec3 x = p * 9.0 + uSeed * 2.0;
    vec3 ip = floor(x);
    vec3 fp = fract(x);
    float rings = 0.0;
    for (int n = 0; n < uCells; n++) { int i = n % 3 - 1; int j = (n / 3) % 3 - 1; int l = n / 9 - 1;
      vec3 g = vec3(float(i), float(j), float(l));
      vec3 c = vec3(hash3(ip + g), hash3(ip + g + 19.1), hash3(ip + g + 37.7));
      float present = step(0.55, hash3(ip + g + 53.3));
      float d = length(g + c - fp);
      float r = 0.18 + 0.2 * hash3(ip + g + 71.9);
      rings += present * (exp(-pow((d - r) * 40.0, 2.0)) + 0.6 * exp(-pow((d - r * 0.55) * 45.0, 2.0)));
    }
    return clamp(lines * 0.9 + rings, 0.0, 1.5);
  }

  // large-scale terrain with warped, ridged channels
  float terrain(vec3 p, out float ridges) {
    vec3 q = p * uScale * 0.9 + uSeed;
    vec3 w = vec3(fbm3d(q * 1.6 + 3.1), fbm3d(q * 1.6 + 7.7), fbm3d(q * 1.6 + 1.3)) - 0.5;
    float base = fbm3d(q + w);
    ridges = 1.0 - abs(fbm3d(q * 2.4 + w * 1.6 + 5.0) * 2.0 - 1.0);
    return base * 0.75 + ridges * 0.25;
  }

  float surface(vec3 p, out float ridges) {
    return terrain(p, ridges) + craterField(p) * uCraters * 0.35;
  }

  void main() {
    vec3 p = vObj;
    vec3 N = normalize(vWN);
    vec3 V = normalize(cameraPosition - vWP);
    vec3 L = normalize(uLight);

    float rid;
    float h0 = terrain(p, rid);
    float cr = craterField(p) * uCraters;
    float H = h0 + cr * 0.35;

    // relief: tilt the surface by the terrain's slope
    float e = 0.012, r2;
    vec3 slope = vec3(surface(p + vec3(e, 0.0, 0.0), r2) - H, surface(p + vec3(0.0, e, 0.0), r2) - H, surface(p + vec3(0.0, 0.0, e), r2) - H) / e;
    float isLand = smoothstep(uSea - 0.012, uSea + 0.012, h0);
    vec3 Nb = normalize(mix(N, normalize(N - (uModelRot * slope) * 0.07), isLand));

    // surface colour
    float tone = fbm3d(p * uScale * 1.2 + uSeed + 9.0);
    vec3 land = mix(uLandA, uLandB, smoothstep(0.25, 0.75, tone));
    land *= 0.8 + 0.4 * smoothstep(0.2, 0.8, h0);   // high ground is paler
    land *= 1.0 + cr * 0.6;                          // crater floors darker, rims brighter
    land *= 0.88 + 0.24 * rid;                       // channels and ridges
    land *= 0.9 + 0.2 * fbm3d(p * uScale * 10.0 + uSeed);
    land *= 1.0 - 0.28 * max(step(0.95, uCity) * 0.0 + uGrid, 0.0) * step(0.5, noise3(p * 70.0 + uSeed)); // built-over worlds: a mottled mass of buildings
    vec3 ocean = mix(uDeep, uShallow, smoothstep(uSea - 0.2, uSea, h0));
    vec3 col = mix(ocean, land, isLand);
    float ice = smoothstep(0.76, 0.92, abs(p.y) + (h0 - 0.5) * 0.3) * uIce;
    col = mix(col, vec3(0.9, 0.94, 1.0), ice);
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 0.9);

    // soft marbled clouds
    vec3 cq = p * 2.2 + uSeed;
    vec3 cw = vec3(fbm3d(cq + vec3(uTime * 0.01, 0.0, 0.0) + 1.7), fbm3d(cq + 4.3), fbm3d(cq + 8.1)) - 0.5;
    float swirl = fbm3d(cq * 1.3 + cw * 2.4);
    float band = 0.5 + 0.5 * sin(p.y * 9.0 + cw.x * 5.0);
    float cloud = smoothstep(0.42, 0.85, swirl * 0.8 + band * 0.25) * uCloud;

    // lighting: a single sun, a soft terminator, relief catching the light
    float ndl = dot(N, L);
    float soft = smoothstep(-0.2, 0.6, ndl);
    float diff = max(dot(Nb, L), 0.0);
    vec3 lit = col * (uAmbient + soft * (0.22 + 1.05 * diff));
    vec3 cloudLit = uCloudCol * (0.03 + soft * (0.35 + 0.8 * max(ndl, 0.0)));
    lit = mix(lit, cloudLit, cloud * 0.9);
    lit += vec3(0.8, 0.9, 1.0) * pow(max(dot(reflect(-L, Nb), V), 0.0), 28.0) * (1.0 - isLand) * (1.0 - cloud) * soft * 0.35;

    // city lights on the night side
    float night = 1.0 - smoothstep(-0.05, 0.2, ndl);
    float clusters = smoothstep(0.48 - 0.25 * uGrid, 0.72 - 0.25 * uGrid, fbm3d(p * 5.0 + uSeed + 40.0));
    float dots = step(0.7 - 0.12 * uGrid, noise3(p * 90.0));
    lit += vec3(1.0, 0.78, 0.45) * clusters * dots * isLand * uCity * night * (1.0 - cloud * 0.6) * 1.7;

    // golden roads and ring structures glow on the day side too, and blaze on the night side
    if (uGrid > 0.0) {
      float gg = gridGlow(p) * isLand * uGrid * (1.0 - cloud * 0.7);
      lit += vec3(1.0, 0.68, 0.28) * gg * (0.3 + 0.9 * night);
    }

    lit *= 1.25; // a brighter lit side, like the reference

    // atmosphere: haze lightens the planet toward its edge, with a warm band at the terminator
    float limb = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    lit += uAtmo * limb * (0.12 + 0.9 * soft) * uHaze * 0.7;
    lit += uAtmo * 0.15 * soft * limb * uHaze * 0.5;
    lit += mix(vec3(1.0, 0.5, 0.25), uAtmo, 0.3) * exp(-pow(ndl * 5.0, 2.0)) * 0.1 * uHaze;

    // lava and cracks glow on their own
    float vein = abs(fbm3d(p * uScale * 1.6 + uSeed + 21.0) - 0.5);
    float lowland = smoothstep(0.58, 0.32, h0);
    float g = clamp(1.0 - vein * 10.0, 0.0, 1.0);
    vec3 lavaCol = mix(vec3(0.75, 0.1, 0.02), vec3(1.0, 0.78, 0.35), g * g);
    float molten = uLava * isLand * (0.35 + 0.65 * lowland) + uCrack;
    lit += lavaCol * pow(g, 3.0) * molten * 1.3;
    lit += vec3(1.0, 0.3, 0.05) * pow(g, 1.5) * molten * 0.12 * (1.0 - soft * 0.5); // molten glow on nearby rock

    gl_FragColor = vec4(lit, 1.0);
  }
`

/**
 * Hand-built looks for the two most important worlds: Terra (hero = 1) and Mars (hero = 2).
 * Terra: rust and tan continents covered in a mottled mass of hive-cities, big concentric golden ring
 * complexes and golden roads, thick swirling cream clouds, lights everywhere, a golden rim.
 * Mars: rust-red desert, dark basalt plains, craters, a great equatorial canyon, vast dark Mechanicum
 * forge-cities with furnace glow, polar caps and a thin dusty haze.
 */
export const HERO_HEAD = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWN;
  varying vec3 vWP;
  uniform float uTime, uSeed;
  uniform int uCells;
  uniform vec3 uAtmo, uLight;
  uniform mat3 uModelRot;
  ${NOISE3}

#if HERO == 2
  float craters(vec3 p) {
    float h = 0.0;
    vec3 x = p * 8.0 + uSeed * 1.3;
    vec3 ip = floor(x);
    vec3 fp = fract(x);
    for (int n = 0; n < uCells; n++) { int i = n % 3 - 1; int j = (n / 3) % 3 - 1; int l = n / 9 - 1;
      vec3 g = vec3(float(i), float(j), float(l));
      vec3 c = vec3(hash3(ip + g), hash3(ip + g + 19.1), hash3(ip + g + 37.7));
      float present = step(0.58, hash3(ip + g + 53.3));
      float r = 0.16 + 0.2 * hash3(ip + g + 71.9);
      float d = length(g + c - fp) / r;
      h += present * (-(1.0 - smoothstep(0.0, 1.0, d)) * 0.6 + exp(-pow((d - 1.0) * 4.0, 2.0)) * 0.35);
    }
    return h;
  }
#endif

  // how rough the ground is, for the light to catch
  float rough(vec3 p) {
    float h = fbm3d(p * 7.0 + uSeed) * 0.6;
#if HERO == 2
    h += craters(p) * 0.3; // only Mars is cratered
#endif
    return h;
  }

  void main() {
    vec3 p = vObj;
    vec3 N = normalize(vWN);
    vec3 V = normalize(cameraPosition - vWP);
    vec3 L = normalize(uLight);

    float ndl = dot(N, L);
    float soft = smoothstep(-0.2, 0.6, ndl);
    float night = 1.0 - smoothstep(-0.05, 0.2, ndl);

    // relief
    float e = 0.012, h0 = rough(p);
    vec3 slope = vec3(rough(p + vec3(e, 0.0, 0.0)) - h0, rough(p + vec3(0.0, e, 0.0)) - h0, rough(p + vec3(0.0, 0.0, e)) - h0) / e;
    vec3 Nb = normalize(N - (uModelRot * slope) * 0.05);

    // continents: warped, so coastlines and landmasses look natural
    vec3 hw = vec3(fbm3d(p * 1.5 + 3.0), fbm3d(p * 1.5 + 7.0), fbm3d(p * 1.5 + 1.0)) - 0.5;
    float h = fbm3d(p * 2.0 + uSeed + hw * 1.3);
    float tone = fbm3d(p * 3.2 + uSeed + 9.0);

    // clouds: thick cream swirls on Terra, a thin veil of dust on Mars
    float cs = HERO == 1 ? 1.25 : 2.4;
    vec3 cq = p * cs + uSeed;
    vec3 cw = vec3(fbm3d(cq + vec3(uTime * 0.008, 0.0, 0.0) + 1.7), fbm3d(cq + 4.3), fbm3d(cq + 8.1)) - 0.5;
    float swirl = fbm3d(cq * 1.3 + cw * 2.6);
    float band = 0.5 + 0.5 * sin(p.y * 7.0 + cw.x * 6.0);

    vec3 col;
    vec3 glow = vec3(0.0);
    float water = 0.0;
    float fortressClear = 0.0;
    float cloud;
    vec3 cloudCol;
    vec3 rim;

`

const HERO_BODY_TERRA = /* glsl */ `
      // ---------- TERRA ----------
      col = mix(vec3(0.5, 0.2, 0.11), vec3(0.84, 0.64, 0.4), smoothstep(0.4, 0.8, tone));
      col = mix(col, vec3(0.2, 0.2, 0.17), smoothstep(0.42, 0.3, h) * 0.8);   // dark basins
      col *= 0.72 + 0.56 * fbm3d(p * 38.0 + uSeed);                           // the mottled mass of hive-cities
      // dark scars cutting across the continents
      float scar = pow(clamp(1.0 - abs(fbm3d(p * 5.0 + uSeed + 7.0) - 0.5) * 12.0, 0.0, 1.0), 3.0);
      col *= 1.0 - 0.45 * scar;

      // concentric golden ring complexes with spokes
      float rings = 0.0;
      vec3 x = p * 3.4 + uSeed * 2.0;
      vec3 ip = floor(x);
      vec3 fp = fract(x);
      for (int n = 0; n < uCells; n++) { int i = n % 3 - 1; int j = (n / 3) % 3 - 1; int l = n / 9 - 1;
        vec3 g = vec3(float(i), float(j), float(l));
        vec3 c = vec3(hash3(ip + g), hash3(ip + g + 19.1), hash3(ip + g + 37.7));
        float present = step(0.5, hash3(ip + g + 53.3));
        vec3 vd = g + c - fp;
        float d = length(vd);
        float r = 0.26 + 0.26 * hash3(ip + g + 71.9);
        float ring = exp(-pow((d - r) * 30.0, 2.0)) + 0.7 * exp(-pow((d - r * 0.7) * 34.0, 2.0)) + 0.5 * exp(-pow((d - r * 0.4) * 38.0, 2.0)) + 0.5 * exp(-pow((d - r * 1.25) * 32.0, 2.0));
        float spokes = (exp(-pow(vd.y * 40.0, 2.0)) + exp(-pow(vd.z * 40.0, 2.0))) * smoothstep(r * 1.25, r * 0.9, d);
        rings += present * (ring + 0.4 * spokes);
      }
      // a network of golden roads
      float roads = pow(clamp(1.0 - abs(fbm3d(p * 12.0 + uSeed + 3.0) - 0.5) * 20.0, 0.0, 1.0), 2.0) * 0.6;
      float net = clamp(rings + roads, 0.0, 1.5);

      cloud = smoothstep(0.38, 0.8, swirl * 0.9 + band * 0.2) * 0.8;
      cloudCol = vec3(0.95, 0.88, 0.72);

      float lights = step(0.76, noise3(p * 110.0)) * smoothstep(0.3, 0.55, fbm3d(p * 4.0 + uSeed + 40.0));
      glow += vec3(1.0, 0.72, 0.3) * net * (0.3 + 0.9 * night) * (1.0 - cloud * 0.85);
      glow += vec3(1.0, 0.82, 0.5) * lights * (0.25 + 1.2 * night) * (1.0 - cloud * 0.7);
      rim = vec3(1.0, 0.72, 0.3);
`

const HERO_BODY_MARS = /* glsl */ `
      // ---------- MARS: the forge world ----------
      // bright orange plates cracked apart by dark seams
      col = mix(vec3(0.62, 0.26, 0.12), vec3(0.95, 0.52, 0.22), smoothstep(0.25, 0.7, tone));
      float crack = pow(clamp(1.0 - abs(fbm3d(p * 9.0 + uSeed + 2.0) - 0.5) * 18.0, 0.0, 1.0), 2.0);
      col *= 1.0 - 0.45 * crack;
      col *= 1.0 + craters(p) * 0.4;

      // the great canyon across the equator
      float lon = atan(p.z, p.x);
      float cn = fbm3d(p * 6.0 + uSeed) - 0.5;
      float canyon = exp(-pow((p.y + 0.1 * sin(lon * 2.0 + 1.0) + cn * 0.08) * 28.0, 2.0)) * smoothstep(-0.3, 0.4, cos(lon - 0.8));
      col *= 1.0 - 0.5 * canyon;

      // pale tan forge-city sprawl spreading across the plates
      float fm = fbm3d(p * 2.4 + uSeed + 60.0);
      float sprawl = smoothstep(0.52, 0.66, fm);
      vec3 tanCity = vec3(0.86, 0.72, 0.5) * (0.6 + 0.7 * fbm3d(p * 34.0 + uSeed));
      col = mix(col, tanCity, sprawl * 0.85);
      col *= 1.0 - 0.3 * step(0.5, noise3(p * 80.0 + uSeed)) * sprawl;

      // dark radial hub complexes: a core, a ring and a burst of spokes
      float hubs = 0.0;
      float hubGlow = 0.0;
      {
        vec3 hx = p * 5.0 + uSeed * 1.7;
        vec3 hip = floor(hx);
        vec3 hfp = fract(hx);
        for (int n = 0; n < uCells; n++) { int i = n % 3 - 1; int j = (n / 3) % 3 - 1; int l = n / 9 - 1;
          vec3 g = vec3(float(i), float(j), float(l));
          vec3 c = vec3(hash3(hip + g), hash3(hip + g + 19.1), hash3(hip + g + 37.7));
          float present = step(0.58, hash3(hip + g + 53.3));
          vec3 vd = g + c - hfp;
          float d = length(vd);
          float r = 0.14 + 0.14 * hash3(hip + g + 71.9);
          float core = smoothstep(r * 0.5, r * 0.2, d);
          float spikes = pow(abs(sin(atan(vd.y, vd.z) * 14.0)), 6.0) * smoothstep(r * 1.7, r * 0.4, d);
          float ringLine = exp(-pow((d - r * 0.8) * 40.0, 2.0));
          hubs += present * (core + spikes * 0.8 + ringLine * 0.6);
          hubGlow += present * core;
        }
      }
      col = mix(col, vec3(0.1, 0.06, 0.04), clamp(hubs, 0.0, 1.0) * 0.8);

      // furnaces burn in the hubs and along the sprawl, fiercest on the night side
      float fdots = step(0.74, noise3(p * 100.0 + uSeed)) * sprawl;
      glow += vec3(1.0, 0.5, 0.16) * (hubGlow * 0.9 + fdots * 1.1) * (0.3 + 1.0 * night);

      col = mix(col, vec3(0.9, 0.88, 0.86), smoothstep(0.975, 0.997, abs(p.y) + 0.03 * (h - 0.5)) * 0.8); // small polar caps

      cloud = smoothstep(0.55, 0.85, swirl) * 0.2;
      cloudCol = vec3(0.85, 0.6, 0.4);
      rim = vec3(0.95, 0.5, 0.3);
`

const HERO_BODY_MACRAGGE = /* glsl */ `
      // ---------- MACRAGGE: Ultramar's capital ----------
      float sea = 0.5;
      float shore = smoothstep(sea - 0.012, sea + 0.012, h);
      water = 1.0 - shore;
      vec3 ocean = mix(vec3(0.02, 0.08, 0.22), vec3(0.08, 0.32, 0.52), smoothstep(sea - 0.22, sea, h));
      float elev = smoothstep(sea, sea + 0.28, h);
      float mtn = fbm3d(p * 6.0 + uSeed + 3.0);
      vec3 lowland = mix(vec3(0.10, 0.30, 0.12), vec3(0.30, 0.44, 0.17), tone);
      vec3 rock = mix(vec3(0.36, 0.31, 0.26), vec3(0.78, 0.79, 0.82), smoothstep(0.55, 0.85, elev + 0.25 * (mtn - 0.5)));
      vec3 landC = mix(lowland, rock, smoothstep(0.35, 0.62, elev + 0.25 * (mtn - 0.5)));
      landC *= 0.9 + 0.2 * fbm3d(p * 20.0 + uSeed);
      col = mix(ocean, landC, shore);
      col = mix(col, vec3(0.9, 0.94, 1.0), smoothstep(0.82, 0.93, abs(p.y) + (h - 0.5) * 0.25) * 0.9);

      // cities along the coasts, glowing blue-white
      float coast = shore * smoothstep(0.10, 0.0, abs(h - sea - 0.04));
      float cdots = step(0.7, noise3(p * 100.0 + uSeed));
      float cclus = smoothstep(0.35, 0.6, fbm3d(p * 5.0 + uSeed + 40.0));
      glow += vec3(0.7, 0.85, 1.0) * coast * cdots * (0.6 + 0.4 * cclus) * (0.15 + 1.3 * night);

      // the Fortress of Hera: a great star-shaped fortress
      vec3 hera = normalize(vec3(0.35, 0.45, 0.82));
      vec3 t1 = normalize(cross(hera, vec3(0.0, 1.0, 0.0)));
      vec3 t2 = cross(hera, t1);
      vec2 q = vec2(dot(p, t1), dot(p, t2));
      float qr = length(q);
      float qa = atan(q.y, q.x);
      float R0 = 0.2;
      float star = R0 * (0.3 + 0.7 * pow(max(cos(5.0 * qa), 0.0), 1.6)); // five sharp bastions
      float hemi = step(0.0, dot(p, hera));
      float wall = exp(-pow((qr - star) * 55.0, 2.0)) + 0.8 * exp(-pow((qr - R0 * 0.32) * 60.0, 2.0)) + 0.5 * exp(-pow((qr - star * 0.62) * 55.0, 2.0));
      float inside = smoothstep(star * 1.05, star * 0.9, qr) * hemi;
      col = mix(col, vec3(0.62, 0.64, 0.7), inside * 0.8);
      glow += vec3(0.5, 0.7, 1.0) * wall * hemi * (0.25 + 1.0 * night);
      fortressClear = inside;

      cloud = smoothstep(0.45, 0.85, swirl * 0.85 + band * 0.2) * 0.6 * (1.0 - fortressClear);
      cloudCol = vec3(0.96, 0.97, 1.0);
      rim = vec3(0.35, 0.6, 1.0);
`

const HERO_BODY_NECROMUNDA = /* glsl */ `
      // ---------- NECROMUNDA: the great hive world ----------
      cloud = smoothstep(0.3, 0.75, swirl * 0.9 + band * 0.2) * 0.8;
      cloudCol = vec3(0.62, 0.57, 0.3);
      rim = vec3(0.78, 0.8, 0.3);

      col = mix(vec3(0.13, 0.11, 0.10), vec3(0.34, 0.29, 0.24), smoothstep(0.3, 0.75, tone));
      col *= 0.7 + 0.6 * fbm3d(p * 45.0 + uSeed);
      float scarN = pow(clamp(1.0 - abs(fbm3d(p * 5.0 + uSeed + 7.0) - 0.5) * 12.0, 0.0, 1.0), 3.0);
      col *= 1.0 - 0.4 * scarN;

      // vast hive-cities: round sprawls of rings and radial streets
      float hive = 0.0;
      float streets = 0.0;
      {
        vec3 hx = p * 3.0 + uSeed * 1.9;
        vec3 hip = floor(hx);
        vec3 hfp = fract(hx);
        for (int n = 0; n < uCells; n++) { int i = n % 3 - 1; int j = (n / 3) % 3 - 1; int l = n / 9 - 1;
          vec3 g = vec3(float(i), float(j), float(l));
          vec3 c = vec3(hash3(hip + g), hash3(hip + g + 19.1), hash3(hip + g + 37.7));
          float present = step(0.35, hash3(hip + g + 53.3));
          vec3 vd = g + c - hfp;
          float d = length(vd) * (1.0 + (fbm3d(p * 9.0 + uSeed + hash3(hip + g) * 10.0) - 0.5) * 0.7); // ragged edges
          float r = 0.32 + 0.22 * hash3(hip + g + 71.9);
          float inside = smoothstep(r, r * 0.75, d);
          float rr = exp(-pow((d - r * 0.85) * 24.0, 2.0)) + 0.8 * exp(-pow((d - r * 0.6) * 28.0, 2.0)) + 0.8 * exp(-pow((d - r * 0.35) * 32.0, 2.0));
          float spokes = pow(abs(sin(atan(vd.y, vd.z) * 9.0)), 14.0) * smoothstep(r, r * 0.2, d);
          hive += present * inside;
          streets += present * (rr + 0.6 * spokes);
        }
      }
      hive = clamp(hive, 0.0, 1.0);
      col = mix(col, vec3(0.42, 0.34, 0.26) * (0.7 + 0.6 * fbm3d(p * 70.0 + uSeed)), hive * 0.8);
      float ldots = step(0.62, noise3(p * 120.0 + uSeed)) * hive;
      glow += vec3(1.0, 0.52, 0.14) * (clamp(streets, 0.0, 1.5) * 0.5 + ldots * 0.9 + hive * 0.18) * (0.3 + 1.0 * night) * (1.0 - cloud * 0.6);
`

const HERO_BODY_CADIA = /* glsl */ `
      // ---------- CADIA (30K): the fortress world, before its fall ----------
      float sea = 0.3;
      float shore = smoothstep(sea - 0.012, sea + 0.012, h);
      water = 1.0 - shore;
      vec3 ocean = mix(vec3(0.05, 0.09, 0.14), vec3(0.14, 0.26, 0.34), smoothstep(sea - 0.2, sea, h));
      float elev = smoothstep(sea, sea + 0.3, h);
      float mtn = fbm3d(p * 6.0 + uSeed + 3.0);
      vec3 lowland = mix(vec3(0.20, 0.27, 0.15), vec3(0.34, 0.33, 0.2), tone);
      vec3 rock = mix(vec3(0.33, 0.29, 0.26), vec3(0.78, 0.78, 0.8), smoothstep(0.86, 1.05, elev + 0.25 * (mtn - 0.5)));
      vec3 landC = mix(lowland, rock, smoothstep(0.42, 0.7, elev + 0.25 * (mtn - 0.5)));
      landC *= 0.9 + 0.2 * fbm3d(p * 20.0 + uSeed);
      col = mix(ocean, landC, shore);
      col = mix(col, vec3(0.88, 0.92, 0.96), smoothstep(0.84, 0.94, abs(p.y) + (h - 0.5) * 0.25) * 0.85);

      cloud = smoothstep(0.52, 0.88, swirl * 0.85 + band * 0.2) * 0.35;
      cloudCol = vec3(0.92, 0.93, 0.96);
      rim = vec3(0.75, 0.8, 0.9);

      // Kasr fortress-cities: star-shaped bastion forts scattered across the land
      {
        vec3 fx = p * 6.5 + uSeed * 1.3;
        vec3 fip = floor(fx);
        vec3 ffp = fract(fx);
        float walls = 0.0;
        float stone = 0.0;
        for (int n = 0; n < uCells; n++) { int i = n % 3 - 1; int j = (n / 3) % 3 - 1; int l = n / 9 - 1;
          vec3 g = vec3(float(i), float(j), float(l));
          vec3 c = vec3(hash3(fip + g), hash3(fip + g + 19.1), hash3(fip + g + 37.7));
          float present = step(0.5, hash3(fip + g + 53.3));
          vec3 vd = g + c - ffp;
          float d = length(vd);
          float r = 0.2 + 0.12 * hash3(fip + g + 71.9);
          float a = atan(vd.y, vd.z);
          float star = r * (0.3 + 0.7 * pow(max(cos(5.0 * a), 0.0), 1.6));
          walls += present * (exp(-pow((d - star) * 70.0, 2.0)) + 0.7 * exp(-pow((d - r * 0.3) * 80.0, 2.0)));
          stone += present * smoothstep(star * 1.05, star * 0.85, d);
        }
        col = mix(col, vec3(0.62, 0.6, 0.58), clamp(stone, 0.0, 1.0) * shore * 0.85);
        col *= 1.0 - 0.45 * clamp(walls, 0.0, 1.0) * shore; // dark bastion walls by day
        glow += vec3(1.0, 0.78, 0.42) * clamp(walls, 0.0, 1.0) * shore * (0.25 + 0.9 * night) * (1.0 - cloud * 0.6);
      }
`

const HERO_BODY_BAAL = /* glsl */ `
      // ---------- BAAL: the blood-red desert world ----------
      col = mix(vec3(0.46, 0.14, 0.08), vec3(0.78, 0.30, 0.16), smoothstep(0.25, 0.75, tone));
      float dunes = sin(p.y * 46.0 + fbm3d(p * 5.0 + uSeed) * 9.0) * 0.5 + 0.5;
      col *= 0.82 + 0.3 * dunes;
      float plateau = smoothstep(0.55, 0.62, fbm3d(p * 2.2 + uSeed + 30.0));
      col = mix(col, vec3(0.22, 0.1, 0.08) * (0.8 + 0.4 * fbm3d(p * 18.0 + uSeed)), plateau * 0.7); // dark rock mesas
      float ridgeB = pow(clamp(1.0 - abs(fbm3d(p * 8.0 + uSeed + 4.0) - 0.5) * 14.0, 0.0, 1.0), 2.0);
      col *= 1.0 - 0.3 * ridgeB;

      cloud = smoothstep(0.4, 0.8, swirl * 0.9 + band * 0.25) * 0.5; // great dust storms
      cloudCol = vec3(0.8, 0.42, 0.28);
      rim = vec3(1.0, 0.4, 0.25);

      // a few scattered settlements glowing gold at night
      float settle = step(0.8, noise3(p * 90.0 + uSeed)) * smoothstep(0.62, 0.75, fbm3d(p * 4.0 + uSeed + 50.0));
      glow += vec3(1.0, 0.75, 0.4) * settle * night * 0.9;
`

const HERO_BODY_FENRIS = /* glsl */ `
      // ---------- FENRIS: the glacial storm world ----------
      float sea = 0.3;
      float shore = smoothstep(sea - 0.012, sea + 0.012, h);

      // frozen seas: pack ice cracked open to the dark water beneath
      vec3 iceC = mix(vec3(0.42, 0.62, 0.84), vec3(0.84, 0.92, 1.0), tone);
      float crackI = pow(clamp(1.0 - abs(fbm3d(p * 10.0 + uSeed + 2.0) - 0.5) * 16.0, 0.0, 1.0), 2.0);
      iceC = mix(iceC, vec3(0.04, 0.12, 0.26), crackI * 0.9);

      // land: dark jagged rock under snow
      float elev = smoothstep(sea, sea + 0.3, h);
      float mtn = fbm3d(p * 8.0 + uSeed + 3.0);
      vec3 rockF = mix(vec3(0.18, 0.2, 0.24), vec3(0.45, 0.48, 0.54), mtn);
      float snow = 1.0 - smoothstep(0.4, 0.7, elev + 0.4 * (mtn - 0.5)) * 0.9; // lowlands snow-covered; bare rock only on the high ranges
      vec3 landF = mix(rockF, vec3(0.92, 0.95, 1.0), snow);
      col = mix(iceC, landF, shore);
      col = mix(col, vec3(0.93, 0.96, 1.0), smoothstep(0.7, 0.85, abs(p.y) + (h - 0.5) * 0.3)); // big polar caps

      // heavy blizzard clouds
      cloud = smoothstep(0.38, 0.8, swirl * 0.9 + band * 0.3) * 0.5;
      cloudCol = vec3(0.9, 0.95, 1.0);
      rim = vec3(0.6, 0.85, 1.0);

      // a great spiral cyclone
      {
        vec3 cdir = normalize(vec3(-0.4, 0.35, 0.85));
        vec3 t1 = normalize(cross(cdir, vec3(0.0, 1.0, 0.0)));
        vec3 t2 = cross(cdir, t1);
        vec2 q = vec2(dot(p, t1), dot(p, t2));
        float qr = length(q);
        float qa = atan(q.y, q.x);
        float spir = 0.5 + 0.5 * sin(3.0 * qa + 22.0 * qr - uTime * 0.2);
        float mask = (1.0 - smoothstep(0.04, 0.34, qr)) * step(0.0, dot(p, cdir));
        cloud = mix(cloud, 0.62 + 0.38 * spir, mask); // the storm replaces the cloud beneath it
      }

      // the Fang: a cluster of amber lights on a mountain
      {
        vec3 fdir = normalize(vec3(0.55, 0.15, 0.82));
        float near = 1.0 - smoothstep(0.0, 0.08, length(p - fdir));
        float fl = step(0.6, noise3(p * 170.0 + uSeed)) * near;
        glow += vec3(1.0, 0.7, 0.3) * (fl * 1.4 + near * 0.25) * (0.3 + 1.0 * night) * (1.0 - cloud * 0.7);
      }
`

const HERO_BODY_PROSPERO30 = /* glsl */ `
      // ---------- PROSPERO (30K): the pristine world of golden cities ----------
      float sea = 0.42;
      float shore = smoothstep(sea - 0.012, sea + 0.012, h);
      water = 1.0 - shore;
      vec3 ocean = mix(vec3(0.03, 0.12, 0.3), vec3(0.1, 0.4, 0.55), smoothstep(sea - 0.2, sea, h));
      vec3 landP = mix(vec3(0.16, 0.36, 0.2), vec3(0.64, 0.56, 0.26), tone);
      landP *= 0.9 + 0.2 * fbm3d(p * 20.0 + uSeed);
      col = mix(ocean, landP, shore);
      col = mix(col, vec3(0.92, 0.95, 1.0), smoothstep(0.86, 0.95, abs(p.y) + (h - 0.5) * 0.25) * 0.85);

      cloud = smoothstep(0.45, 0.85, swirl * 0.85 + band * 0.2) * 0.45;
      cloudCol = vec3(1.0, 0.97, 0.92);
      rim = vec3(1.0, 0.85, 0.5);

      // golden cities scattered across the land
      float gdots = step(0.74, noise3(p * 100.0 + uSeed)) * smoothstep(0.38, 0.62, fbm3d(p * 5.0 + uSeed + 40.0));
      glow += vec3(1.0, 0.82, 0.45) * gdots * shore * (0.3 + 1.2 * night) * (1.0 - cloud * 0.6);

      // Tizca, the capital: concentric golden rings and spokes
      {
        vec3 tdir = normalize(vec3(0.3, 0.2, 0.93));
        vec3 t1 = normalize(cross(tdir, vec3(0.0, 1.0, 0.0)));
        vec3 t2 = cross(tdir, t1);
        vec2 q = vec2(dot(p, t1), dot(p, t2));
        float qr = length(q);
        float qa = atan(q.y, q.x);
        float hemi = step(0.0, dot(p, tdir));
        float rings = exp(-pow((qr - 0.06) * 90.0, 2.0)) + exp(-pow((qr - 0.11) * 80.0, 2.0)) + exp(-pow((qr - 0.17) * 70.0, 2.0));
        float spokes = pow(abs(sin(qa * 4.0)), 18.0) * (1.0 - smoothstep(0.03, 0.18, qr)) * smoothstep(0.0, 0.03, qr);
        float city = (1.0 - smoothstep(0.1, 0.2, qr)) * hemi;
        col = mix(col, vec3(0.78, 0.7, 0.45), city * 0.5);
        glow += vec3(1.0, 0.8, 0.4) * (rings + spokes * 0.8) * hemi * (0.45 + 1.0 * night) * (1.0 - cloud * 0.5);
      }
`

const HERO_BODY_PROSPERO40 = /* glsl */ `
      // ---------- PROSPERO (40K): the Planet of the Sorcerers, a ruin ----------
      col = mix(vec3(0.1, 0.09, 0.09), vec3(0.32, 0.28, 0.26), smoothstep(0.3, 0.75, tone));
      col *= 0.75 + 0.5 * fbm3d(p * 30.0 + uSeed);
      float scarR = pow(clamp(1.0 - abs(fbm3d(p * 5.0 + uSeed + 7.0) - 0.5) * 12.0, 0.0, 1.0), 3.0);
      col *= 1.0 - 0.45 * scarR;

      // the burnt grid of dead cities
      vec3 gp = p * 26.0 + uSeed;
      float streets = max(exp(-pow((fract(gp.x) - 0.5) * 14.0, 2.0)), exp(-pow((fract(gp.z) - 0.5) * 14.0, 2.0)));
      float cityMask = smoothstep(0.52, 0.66, fbm3d(p * 3.0 + uSeed + 11.0));
      col = mix(col, col * 0.55 + vec3(0.06, 0.05, 0.05), streets * cityMask * 0.8);

      cloud = smoothstep(0.5, 0.85, swirl * 0.85 + band * 0.2) * 0.35;
      cloudCol = vec3(0.4, 0.36, 0.4);
      rim = vec3(0.65, 0.35, 0.9);

      // sorcery still burning in the ruins: violet veins
      float vein = pow(clamp(1.0 - abs(fbm3d(p * 7.0 + uSeed + 21.0) - 0.5) * 14.0, 0.0, 1.0), 3.0);
      glow += vec3(0.7, 0.25, 1.0) * vein * (0.4 + 0.9 * night) * (1.0 - cloud * 0.6);
`

export const HERO_TAIL = /* glsl */ `

    float diff = max(dot(Nb, L), 0.0);
    vec3 lit = col * (0.02 + soft * (0.22 + 1.05 * diff));
    lit = mix(lit, cloudCol * (0.03 + soft * (0.35 + 0.8 * max(ndl, 0.0))), cloud * 0.9);
    lit += vec3(0.8, 0.9, 1.0) * pow(max(dot(reflect(-L, Nb), V), 0.0), 30.0) * water * (1.0 - cloud) * soft * 0.5; // sun glint on the sea
    lit += glow;
    lit *= HERO == 1 ? 1.05 : (HERO == 2 ? 1.3 : 1.15);

    // atmosphere: haze toward the edge, a bright thin rim, and a warm band at the terminator
    float ndv = max(dot(N, V), 0.0);
    float limb = pow(1.0 - ndv, 2.2);
    float k = HERO == 1 ? 1.0 : (HERO == 2 ? 0.55 : 0.9);
    lit += rim * limb * (0.15 + 0.95 * soft) * 0.75 * k;
    lit += rim * pow(1.0 - ndv, 5.0) * 0.4 * k;
    lit += mix(vec3(1.0, 0.5, 0.25), rim, 0.3) * exp(-pow(ndl * 5.0, 2.0)) * 0.1;

    gl_FragColor = vec4(lit, 1.0);
  }
`

export const HERO_BODIES: Record<number, string> = {
  1: HERO_BODY_TERRA, 2: HERO_BODY_MARS, 3: HERO_BODY_MACRAGGE, 4: HERO_BODY_NECROMUNDA, 5: HERO_BODY_CADIA,
  6: HERO_BODY_BAAL, 7: HERO_BODY_FENRIS, 8: HERO_BODY_PROSPERO30, 9: HERO_BODY_PROSPERO40,
}
