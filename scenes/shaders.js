// GLSL for the migration-flight scenes. World units are metres; y is up.
// The background world is rendered with its own camera (same orientation as the
// bird camera), so everything here is in "real" metres around the flying bird.

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;
  i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m; m=m*m;
  vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
float fbm(vec2 p, int oct){
  float s=0., a=0.5; mat2 r=mat2(0.8,-0.6,0.6,0.8);
  for(int i=0;i<8;i++){ if(i>=oct) break; s+=a*snoise(p); p=r*p*2.03+vec2(17.1,9.3); a*=0.5; }
  return s;
}
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
`;

// Sky colour as a function of direction; also used for haze so the terrain melts
// into the horizon seamlessly.
export const SKY = /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHorizon2; uniform vec3 uBelow; uniform vec3 uGlow; uniform float uGlowPow;
uniform float uFogDensity; uniform float uFogH; uniform float uFogEnd;
uniform vec3 uCam; uniform float uTime;
vec3 skyColor(vec3 d){
  float h = d.y;
  // horizon colour changes with azimuth: sun side vs the opposite side
  vec2 a = normalize(d.xz + vec2(1e-5)), b = normalize(uSunDir.xz + vec2(1e-5));
  float muh = dot(a, b)*0.5 + 0.5;
  vec3 hor = mix(uHorizon2, uHorizon, muh*muh);
  vec3 c = mix(hor, uZenith, pow(clamp(h,0.,1.), 0.45));
  c = mix(c, hor*uBelow, smoothstep(0.0, -0.25, h));
  float mu = max(dot(d, uSunDir), 0.);
  float hb = exp(-abs(h)*6.);
  c += uGlow * (pow(mu, uGlowPow) * (0.25 + 0.75*hb) + 0.4*pow(mu, uGlowPow*12.));
  return c;
}
// fraction of haze between the camera and a point (exponential atmosphere)
float fogAmount(float dist, float y0, float y1){
  float H = uFogH; float dy = y1 - y0;
  float k = abs(dy) < 1. ? exp(-y0/H) : H*(exp(-y0/H)-exp(-y1/H))/dy;
  float f = 1. - exp(-dist*uFogDensity*k);
  return max(f, smoothstep(uFogEnd*0.7, uFogEnd, dist));
}
`;

// ---------------------------------------------------------------- terrain
// HABITAT: 0 Sahara, 1 Kenyan savanna, 2 Alps, 3 farmland, 4 city (day or night), 5 Mediterranean sea,
//          6 Congo rainforest, (7 unused), 8 Mediterranean hills, 9 steppe, 10 taiga,
//          11 tundra, 12 Sahel floodplain (wetland)
const HABITATS = /* glsl */ `
// distance-aware noise: octaves finer than the local mesh resolution fade out
float gDist = 0.;
float fbmT(vec2 p, float L, int oct){
  float s=0., a=0.5, f=1.; mat2 r=mat2(0.8,-0.6,0.6,0.8); vec2 q=p/L;
  for(int i=0;i<8;i++){ if(i>=oct) break; float w = 1.-smoothstep(1.5, 4., gDist*f/L); s+=a*w*snoise(q); q=r*q*2.03+vec2(17.1,9.3); a*=0.5; f*=2.03; }
  return s;
}
float ridgedT(vec2 p, float L){
  float s=0., a=0.5, w=1., f=1.; mat2 r=mat2(0.8,-0.6,0.6,0.8); vec2 q=p/L;
  for(int i=0;i<8;i++){
    float lod = 1.-smoothstep(1.5, 4., gDist*f/L);
    float n=1.-abs(snoise(q)); n*=n;
    s += mix(0.45*0.45, n, lod)*a*w; w=clamp(mix(0.5, n*1.7, lod),0.,1.);
    q=r*q*2.07+vec2(13.,7.); a*=0.5; f*=2.07;
  }
  return s;
}
float riverDist(vec2 p){ return abs(fbm(p/9000.+vec2(3.7,1.2),4)); }

// --- city: one large city ahead of the start point, a river through it, sea to one side
const vec2 CITY = vec2(-1500., 3000.);
float cityRiver(vec2 p){ return abs(p.x - CITY.x - 900. + 2200.*fbm(p/16000.+vec2(5.,1.),3)); }   // metres
float coast(vec2 p){ return fbm(p/30000.+vec2(1.3,-4.1),4) + 0.15 + 0.45*smoothstep(16000., 6000., length(p-CITY)); }
float cityDensity(vec2 p){
  vec2 q = p + 1500.*vec2(snoise(p/6000.), snoise(p/6000.+7.));
  vec2 d = q - CITY;
  float core = exp(-dot(d,d)/(2.*4200.*4200.));
  float towns = 0.75*smoothstep(0.30, 0.70, fbm(p/11000.+vec2(2.,8.),4));
  float u = max(core, towns);
  u *= 0.55 + 0.45*smoothstep(-0.35, 0.25, fbm(p/1700.+vec2(9.,3.),3));   // parks, fields, industry
  return u * smoothstep(-0.0, 0.06, coast(p));
}

// --- Kenyan savanna: kopjes (granite outcrops)
float kopje(vec2 p, out float on){
  float C = 2200.;
  vec2 id = floor(p/C);
  vec2 o = (id + 0.25 + 0.5*hash22(id+5.))*C;
  on = step(0.62, hash12(id+9.));
  float r = 120. + 140.*hash12(id+3.);
  vec2 d = p - o; float ang = hash12(id)*3.14;
  d = mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*d * vec2(1., 1.6);
  float dome = on*pow(max(1.-length(d)/r, 0.), 0.6);
  return dome;
}
// --- Mediterranean islands; one sits ahead of the start point
const vec2 ISLAND = vec2(-10000., 26000.);
float island(vec2 p){
  vec2 d = p - ISLAND;
  return fbm(p/24000.+vec2(4.,1.),4) - 0.50 + 0.70*exp(-dot(d,d)/(2.*5500.*5500.)) + 0.05*snoise(p/3000.) - 0.5*exp(-dot(p,p)/(2.*9000.*9000.));
}
// --- Congo: a big river the bird follows
float congoRiver(vec2 p){ return abs(p.x - 1500. - 2600.*sin(p.y/11000.) - 900.*fbm(p/12000.+vec2(1.,7.),3)); }

// Voronoi: x = distance to the cell border, y = cell hash, z = distance to the centre (cell units)
vec3 voronoi(vec2 x){
  vec2 n = floor(x), f = fract(x), mg = vec2(0.), mr = vec2(0.); float md = 8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i),float(j)); vec2 o = 0.1+0.8*hash22(n+g); vec2 r = g+o-f; float d = dot(r,r);
    if(d < md){ md = d; mr = r; mg = g; }
  }
  float c = sqrt(md); md = 8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = mg + vec2(float(i),float(j)); vec2 o = 0.1+0.8*hash22(n+g); vec2 r = g+o-f;
    if(dot(mr-r,mr-r) > 1e-5) md = min(md, dot(0.5*(mr+r), normalize(r-mr)));
  }
  return vec3(md, hash12(n+mg), c);
}

// city street network: distance (m) to the nearest local street and arterial, and neighbourhood id
void cityRoads(vec2 p, float u, out float dLoc, out float dArt, out float hood){
  vec2 wp2 = p + 260.*vec2(snoise(p/2600.), snoise(p/2600.+4.)) + 40.*vec2(snoise(p/500.), snoise(p/500.+2.));
  vec3 va = voronoi(wp2/900.);
  dArt = va.x*900.;
  hood = va.y;
  if(hood < 0.4){
    float cell = 65. + 55.*(1.-u);
    dLoc = voronoi(wp2/cell).x*cell;
  } else {
    float ang = hood*6.2832;
    mat2 R = mat2(cos(ang),-sin(ang),sin(ang),cos(ang));
    vec2 q = R*wp2; vec2 cell = mix(vec2(140.,90.), vec2(95.,70.), u);
    vec2 fr = fract(q/cell); vec2 dd = min(fr, 1.-fr)*cell;
    dLoc = min(dd.x, dd.y);
  }
}
float terrainHeight(vec2 p){
  gDist = length(p - uCam.xz);
#if HABITAT == 0
  float base = 140.*fbmT(p,12000.,4);
  vec2 w = p + 700.*vec2(snoise(p/6000.), snoise(p/6000.+9.));
  float d1 = dot(w, vec2(0.94,0.34))/650.;
  float d2 = dot(w, vec2(-0.34,0.94))/1500.;
  float fade1 = 1.-smoothstep(4000., 10000., gDist), fade2 = 1.-smoothstep(9000., 22000., gDist);
  float dunes = 45.*pow(1.-abs(sin(d1*3.14159)),2.2)*(0.65+0.35*snoise(p/2500.))*fade1 + 12.*fade1*(1.-fade1)
              + 30.*pow(1.-abs(sin(d2*3.14159)),2.)*fade2 + 10.*(1.-fade2);
  float erg = smoothstep(-0.25,0.25,fbm(p/18000.+3.,3));
  float m = fbmT(p+11.*7000.,7000.,4);
  float mesa = smoothstep(0.18,0.24,m)*110. + smoothstep(0.32,0.36,m)*60.;
  return base + dunes*erg + mesa*(1.-erg);
#elif HABITAT == 1
  float h = 40.*fbmT(p,8000.,4) + 12.*fbmT(p,1500.,3) + 60.;
  h += 950.*smoothstep(0.15, 0.6, fbm(p/32000.+vec2(9.,2.),3)) * (0.55+0.45*fbmT(p,5000.,4));   // hazy hills
  float on; float k = kopje(p, on);
  h += 55.*k*(0.75+0.25*snoise(p/40.)) + 18.*k*k;
  h = mix(h-5., h, smoothstep(0.0015,0.006,riverDist(p)));
  return h;
#elif HABITAT == 2
  vec2 wq = p + 2500.*vec2(snoise(p/20000.), snoise(p/20000.+4.));
  float r = ridgedT(wq, 30000.);
  float massif = smoothstep(-0.7,0.4,fbm(p/90000.,2));
  float h = 250. + 5000.*pow(smoothstep(0.15, 0.85, r), 1.6)*(0.6+0.4*massif);
  h -= max(h-3400.,0.)*0.7;
  return h;
#elif HABITAT == 3
  float h = 60.*fbmT(p,6000.,4) + 14.*fbmT(p,1500.,3) + 25.;
  h = mix(-15., h, smoothstep(0.003,0.02,riverDist(p)));
  return h;
#elif HABITAT == 4
  float h = 30.*fbmT(p,8000.,4) + 25.;
  h = mix(-40., h, smoothstep(-0.02,0.04,coast(p)));
  h = mix(-8., h, smoothstep(110., 170., cityRiver(p)));
  return h;
#elif HABITAT == 5
  float c = island(p);
  float hh = smoothstep(0.0, 0.25, c);
  float r = ridgedT(p, 7000.);
  return -70. + 72.*smoothstep(-0.10, 0.0, c) + 60.*smoothstep(0.0, 0.02, c) + 1400.*pow(hh, 1.3)*(0.35+0.8*r);
#elif HABITAT == 8
  // Mediterranean hills: rounded limestone hills, dry river beds (ramblas)
  float hills = smoothstep(-0.7, 0.3, fbm(p/26000.+vec2(4.,7.),3));
  float r = ridgedT(p + 1500.*vec2(snoise(p/12000.), snoise(p/12000.+3.)), 8000.);
  float h = 300. + 900.*hills*(0.25+0.75*r) + 60.*fbmT(p,2500.,3);
  return mix(h-12., h, smoothstep(0.003,0.012,riverDist(p)));
#elif HABITAT == 9
  // steppe: almost flat, shallow salt lakes in the hollows
  float h = 130. + 22.*fbmT(p,9000.,4) + 5.*fbmT(p,1400.,3);
  return h - 45.*smoothstep(0.22, 0.45, fbm(p/13000.+vec2(5.,2.),3));
#elif HABITAT == 10
  // taiga: low hills, many lakes, a meandering river
  float h = 210. + 70.*fbmT(p,9000.,4) + 18.*fbmT(p,1600.,3);
  h -= 55.*smoothstep(0.18, 0.40, fbm(p/5200.+vec2(2.,6.),4));
  return mix(h-25., h, smoothstep(0.002,0.006,riverDist(p)));
#elif HABITAT == 11
  // tundra: gentle relief, lakes in the hollows
  float h = 90. + 45.*fbmT(p,10000.,4) + 10.*fbmT(p,1200.,3);
  return h - 30.*smoothstep(0.25,0.45,fbm(p/7000.+vec2(8.,1.),3));
#elif HABITAT == 12
  // Sahel floodplain: flat, braided channels and shallow lakes
  float h = 271.5 + 3.*fbmT(p,4000.,3);
  float ch = min(abs(fbm(p/7000.+vec2(1.,3.),3)), abs(fbm(p/3000.+vec2(6.,2.),3))*1.6);
  h -= 6.*(1.-smoothstep(0.02, 0.045, ch));
  return h - 6.*smoothstep(0.05, 0.3, fbm(p/9000.+vec2(3.,8.),3));
#else
  float h = 500. + 170.*fbmT(p,4500.,5) + 45.*fbmT(p,1200.,3);
  float rc = congoRiver(p);
  h = mix(300., h, smoothstep(700., 4500., rc));     // broad valley
  h = mix(282., h, smoothstep(600., 760., rc));      // the channel
  float bar = smoothstep(0.35, 0.5, fbm(p/1100.+vec2(3.,9.),3)) * (1.-smoothstep(380., 560., rc));
  h = max(h, mix(282., 293., bar));
  return h;
#endif
}
`;

export const TERRAIN_VS = NOISE + SKY + HABITATS + /* glsl */ `
uniform float uSpacing; uniform float uHalf; uniform float uWater;
varying vec3 vWorld; varying vec3 vNormal; varying float vH;
void main(){
  vec4 wp = modelMatrix * vec4(position,1.);
  float e = uSpacing;
  float h = terrainHeight(wp.xz);
  // crack-free borders: odd vertices on the outer edge take the coarse neighbour average
  vec2 lp = position.xz;
  if(abs(abs(lp.x)-uHalf) < 0.01 || abs(abs(lp.y)-uHalf) < 0.01){
    vec2 idx = floor(lp + uHalf + 0.5);
    vec2 t = abs(abs(lp.x)-uHalf) < 0.01 ? vec2(0.,1.) : vec2(1.,0.);
    float odd = mod(dot(idx,t), 2.);
    if(odd > 0.5) h = 0.5*(terrainHeight(wp.xz - t*e) + terrainHeight(wp.xz + t*e));
  }
  float hx = terrainHeight(wp.xz + vec2(e,0.)), hz = terrainHeight(wp.xz + vec2(0.,e));
  vNormal = normalize(vec3(h-hx, e, h-hz));
  vH = h;
  float y = max(h, uWater);
  vWorld = vec3(wp.x, y, wp.z);
  vec2 dd = wp.xz - uCam.xz;
  float drop = dot(dd,dd) / (2.*6371000.);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, y - drop, wp.z, 1.);
}
`;

export const TERRAIN_FS = NOISE + SKY + HABITATS + /* glsl */ `
uniform vec4 uInner; // xz centre, half size, enabled
uniform float uSpacing;
uniform float uWater;
uniform float uCloudH; uniform float uCloudCov; uniform float uCloudScale; uniform vec2 uWind; uniform float uCloudShadow;
uniform vec3 uMoonDir; uniform float uLights; uniform float uDesat; uniform float uSeaFog; uniform vec3 uSeaFogCol;
uniform vec3 uWaterCol; uniform float uWave; uniform float uFoam; uniform vec4 uShip; uniform float uMist;
varying vec3 vWorld; varying vec3 vNormal; varying float vH;

float cloudDens(vec2 p, int oct){
  float n = fbm((p + uWind*uTime)/uCloudScale, oct)*0.5+0.5;
  return smoothstep(1.-uCloudCov, 1.-uCloudCov+0.22, n);
}
// energy-conserving dots: individual blobs near, their mean far away
float dots(vec2 p, float cell, float density, float rad, float fw, float seed){
  vec2 g = p/cell; vec2 id = floor(g); vec2 f = fract(g)-0.5;
  vec2 o = (hash22(id+seed)-0.5)*(1.-2.*rad);
  float has = step(1.-density, hash12(id+seed*1.7));
  float r = rad*(0.7+0.6*hash12(id+seed*2.3));
  float px = fw/cell;
  float d = 1.-smoothstep(r-0.5*px, r+0.5*px, length(f-o));
  return mix(has*d, density*3.14159*rad*rad, smoothstep(0.25, 0.9, px/rad));
}
// thin line of half-width w (metres) at distance d, anti-aliased and energy conserving
float lineAA(float d, float w, float fw){ float aw = max(w, fw*0.75); return (w/aw)*(1.-smoothstep(aw*0.5, aw, d)); }
// flat-topped acacia crowns seen from above, plus the shadows they cast along the sun
void acacias(vec2 p, float cell, float dens, float fw, out float crown, out float shadow, out float lit){
  vec2 sOff = -uSunDir.xz / max(uSunDir.y, 0.15) * 8.;
  vec2 id0 = floor(p/cell);
  crown = 0.; shadow = 0.; lit = 0.;
  vec2 sd = normalize(uSunDir.xz + 1e-4);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 id = id0 + vec2(float(i),float(j));
    if(hash12(id*1.31+2.) > dens) continue;
    vec2 c = (id + 0.15 + 0.7*hash22(id))*cell;
    float r = 4.5 + 5.0*hash12(id+7.);
    vec2 d = p - c;
    float wob = 1. + 0.10*sin(d.x*1.3+hash12(id)*20.) * sin(d.y*1.1);
    float cc = 1. - smoothstep(r*wob - 0.6*fw, r*wob + 0.6*fw, length(d));
    lit = max(lit, cc*(0.5 + 0.5*dot(d/r, sd)));
    crown = max(crown, cc);
    float sc = 1. - smoothstep(r*1.05 - 0.6*fw, r*1.05 + 0.6*fw, length(p - c - sOff));
    shadow = max(shadow, sc);
  }
  float avg = dens*3.14159*52./(cell*cell);
  float k = smoothstep(0.06, 0.25, fw/cell);
  crown = mix(crown, min(avg, 0.95), k); shadow = mix(shadow, min(avg*1.1, 0.9), k); lit = mix(lit, min(avg, 0.95)*0.5, k);
}
// building footprints on a rotated grid (cell cs, metres): 1 on a roof; hb = the building's hash
float bldg(vec2 p, float ang, vec2 cs, float dens, float fw, out float hb){
  mat2 R = mat2(cos(ang),-sin(ang),sin(ang),cos(ang));
  vec2 q = R*p; vec2 id = floor(q/cs); vec2 f = fract(q/cs) - 0.5;
  hb = hash12(id + 17.);
  vec2 ins = 0.5 - (0.08 + 0.14*hash22(id + 3.));
  vec2 d = (abs(f) - ins)*cs;
  float m = (1. - smoothstep(-0.6*fw, 0.6*fw, max(d.x, d.y))) * step(1.-dens, hash12(id + 7.));
  return mix(m, dens*4.*ins.x*ins.y, smoothstep(0.3, 1.0, fw/min(cs.x, cs.y)));
}

void main(){
  if(uInner.w > 0.5){ vec2 q = abs(vWorld.xz - uInner.xy); if(max(q.x,q.y) < uInner.z - uSpacing) discard; }
  vec2 p = vWorld.xz;
  vec3 V = vWorld - uCam; float dist = length(V); vec3 vd = V/dist;
  float fw = max(length(fwidth(p)), 0.5);
  vec3 n = normalize(vNormal);
  vec3 alb = vec3(0.3); vec3 emis = vec3(0.); float water = step(vH, uWater);
  float slope = 1.-n.y;
  float occl = 1.;            // extra direct-light occlusion (tree shadows)
  float mist = 0.;
  vec3 waterEmis = vec3(0.);  // light reflected by water (city)
  float shallow = 0.;
  float surfK = 0.;
  float canopy = 0.;          // share of tree canopy: gets clumpy relief and mottling below
#if HABITAT == 0
  float erg = smoothstep(-0.25,0.25,fbm(p/18000.+3.,3));
  float v = fbm(p/900.,3);
  vec3 sand = mix(lin(vec3(0.80,0.58,0.36)), lin(vec3(0.90,0.72,0.50)), 0.5+0.5*v);
  sand = mix(sand, lin(vec3(0.72,0.47,0.29)), smoothstep(0.2,0.6,fbm(p/5000.+4.,3))*0.6);
  vec3 reg = mix(lin(vec3(0.50,0.38,0.27)), lin(vec3(0.66,0.52,0.38)), 0.5+0.5*fbm(p/400.,3));
  reg = mix(reg, lin(vec3(0.30,0.24,0.20)), smoothstep(0.08,0.35,slope));
  alb = mix(reg, sand, erg);
  alb *= 0.92 + 0.08*n.x;
#elif HABITAT == 1
  float g = 0.5+0.5*fbm(p/2600.,4);
  vec3 grass = mix(lin(vec3(0.76,0.64,0.40)), lin(vec3(0.52,0.54,0.29)), smoothstep(0.3,0.8,g));
  grass *= 0.88 + 0.24*(0.5+0.5*fbm(p/160.,3))*(1.-smoothstep(4.,30.,fw)) + 0.12*smoothstep(4.,30.,fw);
  grass = mix(grass, lin(vec3(0.60,0.40,0.27)), smoothstep(0.5,0.8,fbm(p/1100.+3.,3))*0.45);    // red soil
  float on; float k = kopje(p, on);
  float rd = riverDist(p);
  float fringe = 1.-smoothstep(0.004, 0.012, rd);
  float bed = 1.-smoothstep(0.0012, 0.0025, rd);
  float dens = 0.10 + 0.40*smoothstep(-0.3, 0.5, fbm(p/3500.+8.,3));
  dens = mix(dens, 0.75, fringe);
  dens = mix(dens, 0.5, smoothstep(0.0, 0.25, k)*(1.-smoothstep(0.5,0.8,k)));
  float crown, shadow, clit;
  acacias(p, 42., dens*(1.-bed), fw, crown, shadow, clit);
  float bush = dots(p, 9., 0.35*smoothstep(-0.3,0.4,fbm(p/1500.+2.,2)), 0.22, fw, 4.);
  grass = mix(grass, lin(vec3(0.30,0.33,0.16)), bush*0.8);
  grass = mix(grass, lin(vec3(0.44,0.50,0.25)), smoothstep(0.1, 0.6, fbm(p/700.+11.,3))*0.45);
  alb = grass;
  occl = 1. - 0.8*shadow*(1.-crown);
  vec3 rock = mix(lin(vec3(0.52,0.47,0.43)), lin(vec3(0.66,0.60,0.54)), 0.5+0.5*fbm(p/25.,2));
  alb = mix(alb, rock, smoothstep(0.35, 0.6, k + 0.2*snoise(p/30.)));
  alb = mix(alb, lin(vec3(0.70,0.58,0.42)), bed);
  vec3 crownCol = mix(lin(vec3(0.16,0.21,0.09)), lin(vec3(0.30,0.34,0.14)), clit);
  crownCol = mix(crownCol, lin(vec3(0.20,0.27,0.11)), fringe*0.5);
  alb = mix(alb, crownCol, crown);
  alb = mix(alb, lin(vec3(0.55,0.47,0.35)), smoothstep(0.12,0.3,slope)*(1.-crown)*0.6);
#elif HABITAT == 2
  float dfw = 1.-smoothstep(10., 60., fw);
  if(dfw > 0.){
    float e = 25.;
    float n0 = fbm(p/260., 3), nx = fbm((p+vec2(e,0.))/260., 3), nz = fbm((p+vec2(0.,e))/260., 3);
    float amp = 70.*dfw*smoothstep(0.2, 0.5, slope + 0.3*smoothstep(2000.,2600.,vH));
    n = normalize(n + amp*vec3(n0-nx, 0., n0-nz)/e);
    slope = 1.-n.y;
  }
  vec2 pr = p + vec2(vH*0.5, -vH*0.4);
  float tl = 1850. + 250.*fbm(p/3000.,3);
  float sl = 2600. + 300.*fbm(p/2500.+3.,3);
  vec3 forest = mix(lin(vec3(0.16,0.21,0.13)), lin(vec3(0.22,0.25,0.15)), 0.5+0.5*fbm(p/500.,3));
  vec3 meadow = mix(lin(vec3(0.46,0.46,0.30)), lin(vec3(0.55,0.50,0.34)), 0.5+0.5*fbm(p/700.,3));
  float strata = 0.5+0.5*sin(vH/38. + 3.*fbm(pr/900.,2));
  vec3 rock = mix(lin(vec3(0.40,0.38,0.36)), lin(vec3(0.58,0.55,0.50)), 0.35+0.4*fbm(pr/300.,3)+0.25*strata);
  vec3 snow = lin(vec3(0.94,0.96,1.0));
  vec3 low = mix(forest, meadow, smoothstep(0.0,0.3, fbm(p/1500.,3))*0.5);
  low = mix(low, forest*0.8, smoothstep(0.1, 0.5, fbm(p/350.+9.,3))*0.6);
  alb = mix(low, meadow, smoothstep(tl-80., tl+80., vH));
  alb = mix(alb, rock, smoothstep(2000., 2500., vH));
  alb = mix(alb, rock, smoothstep(0.30, 0.50, slope));
  float slope0 = 1.-normalize(vNormal).y;
  float sn = smoothstep(sl-120., sl+120., vH) * (1.-smoothstep(0.30, 0.55, mix(slope0, slope, 0.35) + 0.08*fbm(p/400.,2)));
  sn = max(sn, smoothstep(sl+500., sl+900., vH)*(1.-smoothstep(0.55,0.75,slope)));
  alb = mix(alb, snow, sn);
#elif HABITAT == 3
  // irregular fields: elongated Voronoi cells whose orientation drifts across the landscape
  vec2 q = p + 70.*vec2(snoise(p/1500.), snoise(p/1500.+5.)) + 10.*vec2(snoise(p/260.), snoise(p/260.+2.));
  float ang = 3.*fbm(p/12000.+3.,2);
  mat2 R = mat2(cos(ang),-sin(ang),sin(ang),cos(ang));
  vec2 r = R*q;
  vec3 vf = voronoi(r/vec2(250., 120.));
  float hsh = vf.y;
  vec3 c1 = lin(vec3(0.66,0.58,0.40)), c2 = lin(vec3(0.38,0.46,0.25)), c3 = lin(vec3(0.30,0.37,0.21));
  vec3 c4 = lin(vec3(0.44,0.36,0.28)), c5 = lin(vec3(0.52,0.54,0.36)), c6 = lin(vec3(0.36,0.30,0.24));
  vec3 fc = hsh<0.22?c1: hsh<0.45?c2: hsh<0.62?c3: hsh<0.8?c4: hsh<0.96?c5: c6;
  vec3 avg = (c1+c2+c3+c4+c5)*0.2;
  fc *= 0.92 + 0.16*fbm(p/120.+hsh*30.,2);
  fc *= 0.80 + 0.40*(0.5+0.5*fbm(p/260.+hsh*13.,3));            // wetter and drier parts of each field
  fc = mix(fc, vec3(dot(fc, vec3(0.3,0.5,0.2))), 0.18);          // a little less saturated
  float tram = lineAA(abs(fract(r.y/24.+hsh)-0.5)*24., 0.9, fw) * step(hsh, 0.62);
  fc *= 1. - 0.18*tram;                                          // tractor tramlines in the crops
  float rows = 0.5+0.5*sin(r.x*0.9 + hsh*20.);
  fc *= mix(1. - 0.10*rows, 1., smoothstep(0.5, 2.5, fw));
  fc = mix(fc, avg, smoothstep(0.3, 1.2, fw/150.));
  float edm = vf.x*120.;                                         // metres to the field border (approx.)
  float hedgeOn = step(0.4, hash12(vec2(hsh*91.7, 3.1)));
  float hedge = hedgeOn*(1.-smoothstep(3.5-0.5*fw, 3.5+0.5*fw, edm));
  hedge = mix(hedge, hedgeOn*8./150., smoothstep(0.5,2.,fw/8.));
  alb = mix(fc, lin(vec3(0.13,0.19,0.10)), hedge);
  float wood = smoothstep(0.36, 0.40, fbm(p/2600.+2.,4) + 0.14*fbm(p/500.,3) + 0.04*fbm(p/90.,2));
  vec3 woodCol = mix(lin(vec3(0.10,0.15,0.08)), lin(vec3(0.16,0.20,0.11)), 0.5+0.5*fbm(p/150.,2));
  alb = mix(alb, woodCol, wood);
  // tree crowns with their shadows: a closed canopy in the woods, single trees in the fields
  float tCrown, tShadow, tLit;
  acacias(p, 11., mix(0.03 + 0.25*hedge, 0.95, wood), fw, tCrown, tShadow, tLit);
  vec3 tCol = mix(lin(vec3(0.13,0.19,0.09)), lin(vec3(0.30,0.36,0.17)), tLit);
  tCol = mix(tCol, lin(vec3(0.40,0.30,0.14)), smoothstep(0.3,0.7,fbm(p/400.+7.,2))*0.35);    // first autumn colours
  alb = mix(alb, tCol, tCrown);
  occl = 1. - 0.75*tShadow*(1.-tCrown);
  canopy = wood;
  float vil = smoothstep(0.55, 0.6, fbm(p/3500.+20.,3));
  float roofs = dots(p, 22., 0.7, 0.3, fw, 4.);
  alb = mix(alb, mix(lin(vec3(0.42,0.40,0.36)), lin(vec3(0.62,0.32,0.24)), roofs), vil*0.85);
  float rd = riverDist(p);
  alb = mix(alb, lin(vec3(0.12,0.18,0.10)), 1.-smoothstep(0.004,0.008,rd));
  water = max(water, 1.-smoothstep(0.0025, 0.0035, rd));
#elif HABITAT == 4
  // ---- city at night: arterial Voronoi network, each neighbourhood with its own street pattern.
  // Near the camera, individual lights are drawn as point sprites (CITYPTS); here: roads, glow, far lights.
  float u = cityDensity(p);
  float riv = cityRiver(p);
  float land = smoothstep(-0.0, 0.03, coast(p)) * smoothstep(120., 150., riv);
  float dLoc, dArt, hood;
  cityRoads(p, u, dLoc, dArt, hood);
  vec2 dc = p - CITY; float rc = length(dc); float ac = atan(dc.y, dc.x);
  float rad = abs(sin((ac + 0.12*snoise(vec2(rc/4000., 1.)))*5.))*rc;     // radial avenues
  float ring = abs(rc - 5200. - 250.*snoise(vec2(ac*3., 2.)));            // ring road
  float hwT = abs(snoise(p/12000.+4.))*12000./1.6;                        // motorways between towns
  float ptFade = smoothstep(8000., 9200., length(p - uCam.xz));
  float street = lineAA(dLoc, 3., fw) * mix(0.04, 0.22, ptFade);
  float art = lineAA(dArt, 5., fw) * mix(0.15, 0.45, ptFade);
  float avenue = max(lineAA(rad, 4.5, fw)*(1.-smoothstep(9000.,12000.,rc)), lineAA(ring, 5., fw));
  float hw = lineAA(hwT, 3.5, fw);
  float coreK = smoothstep(0.45, 0.9, u);
  vec3 sodium = vec3(1.0, 0.52, 0.16), led = vec3(0.82, 0.88, 1.0), warm = vec3(1.0, 0.78, 0.52);
  vec3 lc = mix(sodium, mix(warm, led, step(0.65, hood)), coreK*0.8);
  float rural = (1.-u)*dots(p, 170., 0.25, 0.03, fw, 13.);
  float park = smoothstep(0.15, -0.15, fbm(p/1300.+vec2(9.,3.),3));
  float carpet = ptFade * dots(p, 12., 0.5, 0.12, fw, 27.);               // far house lights (averaged)
  emis = uLights * land * (
      u * (1.-park*0.8) * street * lc * 4.5
    + u * art * mix(sodium, warm, coreK) * 6.
    + avenue * smoothstep(0.1, 0.4, u) * vec3(1.0,0.72,0.42) * 2.4
    + hw * vec3(1.0, 0.58, 0.22) * 1.6 * (1.-smoothstep(0.6,0.9,u))
    + u * (1.-park) * carpet * mix(sodium, warm, 0.5) * 3.5
    + u * u * vec3(1.0, 0.70, 0.42) * 0.03                                  // glow over the built-up area
    + rural * sodium * 3. );
  vec3 dark = mix(lin(vec3(0.06,0.07,0.05)), lin(vec3(0.10,0.10,0.08)), 0.5+0.5*fbm(p/800.,3));
  alb = mix(dark, lin(vec3(0.09,0.085,0.08)), u);
  float near = smoothstep(0.05, 0.5, cityDensity(p + vec2(200.)));
  waterEmis = uLights * near * vec3(1.0,0.65,0.35) * (0.03 + 0.12*smoothstep(0.4, 0.9, snoise(vec2(p.x/6., p.y/90.) + uTime*0.3)));
  waterEmis += uLights * (lineAA(dArt, 5., fw) + avenue) * smoothstep(150., 120., riv) * vec3(1.0,0.75,0.45) * 1.8;   // bridges
  if(uLights < 0.5){   // ---- the same city by day: buildings with shadows, gardens, trees, roads
    vec3 fields = mix(lin(vec3(0.34,0.38,0.22)), lin(vec3(0.52,0.48,0.32)), 0.5+0.5*fbm(p/900.,3));
    fields = mix(fields, lin(vec3(0.18,0.25,0.12)), smoothstep(0.3, 0.5, fbm(p/2500.+5.,3))*0.7);   // woods
    float urban = smoothstep(0.05, 0.22, u) * land;
    park = smoothstep(-0.12, -0.35, fbm(p/1300.+vec2(9.,3.),3));   // fewer, smaller parks by day
    float big = step(0.6, u);                                   // blocks of flats and offices in the centre
    float indus = step(0.30, hood) * step(hood, 0.38) * step(u, 0.6);   // warehouses
    float ang = hood < 0.4 ? 3.*fbm(p/3000.,2) : hood*6.2832;  // follow the neighbourhood's streets
    vec2 cs = indus > 0.5 ? vec2(64., 44.) : big > 0.5 ? vec2(34., 26.) : vec2(15., 12.);
    float dens = mix(0.5, 0.92, smoothstep(0.1, 0.6, u)) * (1. - park*0.9);
    float off = smoothstep(4., 7., dLoc) * smoothstep(7., 11., dArt) * smoothstep(8., 12., rad) * smoothstep(8., 12., ring) * urban;
    float hb, hb2;
    float B = bldg(p, ang, cs, dens, fw, hb) * off;
    float hgt = indus > 0.5 ? 9. : big > 0.5 ? 18. + 22.*hb : 7.;
    vec2 so = uSunDir.xz / max(uSunDir.y, 0.2) * hgt;
    float Bs = bldg(p + so, ang, cs, dens, fw, hb2) * off * (1.-B);
    vec3 roof = indus > 0.5 ? mix(lin(vec3(0.70,0.71,0.72)), lin(vec3(0.52,0.54,0.56)), step(0.5, hb))
              : big > 0.5 ? mix(lin(vec3(0.62,0.61,0.58)), lin(vec3(0.38,0.37,0.36)), step(0.6, hb))
              : hb < 0.55 ? lin(vec3(0.60,0.33,0.24)) : hb < 0.85 ? lin(vec3(0.42,0.40,0.38)) : lin(vec3(0.30,0.28,0.27));
    roof *= 0.9 + 0.2*hash12(vec2(hb*53., 2.));
    vec3 ground = big > 0.5 || indus > 0.5 ? lin(vec3(0.40,0.39,0.37)) : mix(lin(vec3(0.34,0.37,0.26)), lin(vec3(0.44,0.43,0.38)), 0.5+0.5*fbm(p/60.,2));
    ground = mix(ground, lin(vec3(0.24,0.33,0.15)), park);
    float tCrown, tShadow, tLit;
    acacias(p, 10., clamp(park*0.75 + (1.-big)*0.22, 0., 0.9) * urban, fw, tCrown, tShadow, tLit);
    tCrown *= 1.-B;
    vec3 town = mix(ground, roof, B);
    town = mix(town, mix(lin(vec3(0.12,0.18,0.08)), lin(vec3(0.28,0.34,0.15)), tLit), tCrown);
    alb = mix(fields, town, urban);
    float road = max(max(lineAA(dLoc, 4.5, fw), lineAA(dArt, 8., fw))*urban, max(avenue*urban, hw*0.8));
    alb = mix(alb, lin(vec3(0.17,0.17,0.18)), road*0.9);
    occl = 1. - 0.65*max(Bs*(1.-road), tShadow*(1.-tCrown));
  }

#elif HABITAT == 5
  float c = island(p);
  vec3 macchia = mix(lin(vec3(0.30,0.34,0.18)), lin(vec3(0.42,0.42,0.26)), 0.5+0.5*fbm(p/300.,3));
  vec3 lime = mix(lin(vec3(0.70,0.66,0.58)), lin(vec3(0.82,0.78,0.70)), 0.5+0.5*fbm(p/120.,3));
  alb = mix(macchia, lime, smoothstep(0.25, 0.5, slope + 0.25*fbm(p/600.,2)));
  alb = mix(alb, lin(vec3(0.20,0.27,0.12)), smoothstep(0.2,0.5,fbm(p/900.+3.,3))*0.5*(1.-slope));  // pine woods
  float vil = smoothstep(0.45, 0.55, fbm(p/2000.+9.,3)) * (1.-smoothstep(60., 250., vH));
  alb = mix(alb, mix(lin(vec3(0.86,0.84,0.78)), lin(vec3(0.70,0.45,0.32)), step(0.7, hash12(floor(p/9.)))), vil*dots(p, 11., 0.85, 0.38, fw, 5.));
  alb = mix(alb, lin(vec3(0.85,0.77,0.62)), 1.-smoothstep(2., 6., vH));            // beaches
  shallow = smoothstep(-28., -2., vH);
  surfK = 1.;
#elif HABITAT == 8
  // ---- Mediterranean hills: olive groves, stubble, vineyards, maquis, pines, white villages
  vec2 q = p + 30.*vec2(snoise(p/900.), snoise(p/900.+5.));
  float ang = floor((snoise(p/4000.)*0.5+0.5)*4.)*0.45;
  mat2 R = mat2(cos(ang),-sin(ang),sin(ang),cos(ang));
  vec2 r = R*q; vec2 cs = vec2(160., 110.);
  vec2 id = floor(r/cs); vec2 f = fract(r/cs);
  float hs = hash12(id + ang*7.);
  vec3 soil = mix(lin(vec3(0.66,0.52,0.38)), lin(vec3(0.76,0.62,0.46)), 0.5+0.5*fbm(p/300.,3));
  soil = mix(soil, lin(vec3(0.62,0.40,0.28)), smoothstep(0.2,0.6,fbm(p/2500.+6.,3))*0.5);
  vec3 stubble = mix(lin(vec3(0.80,0.68,0.45)), lin(vec3(0.72,0.60,0.40)), hash12(id+3.));
  vec3 grove = mix(soil, lin(vec3(0.17,0.21,0.11)), dots(r, 8., 0.95, 0.38, fw, 2.));
  float vine = smoothstep(0.55, 0.8, 0.5+0.5*sin(r.x*2.4)) * mix(1., 0.35, smoothstep(0.5, 2., fw));
  vec3 vineyard = mix(soil, lin(vec3(0.30,0.33,0.15)), vine);
  vec3 pc = hs<0.40? grove : hs<0.65? stubble : hs<0.80? vineyard : hs<0.92? soil : lin(vec3(0.40,0.44,0.24));
  pc *= 0.93 + 0.14*fbm(p/100.+hs*20.,2);
  pc = mix(pc, mix(soil, lin(vec3(0.45,0.42,0.28)), 0.5), smoothstep(0.3, 1.2, fw/120.));
  vec2 ed = min(f, 1.-f)*cs;
  pc = mix(pc, lin(vec3(0.82,0.74,0.60)), (1.-smoothstep(2.5-0.5*fw, 2.5+0.5*fw, min(ed.x,ed.y)))*(1.-smoothstep(3.,12.,fw))*step(0.6, hash12(id*1.7)));
  float wild = smoothstep(0.06, 0.22, slope + 0.35*fbm(p/3000.+2.,3) + 0.05);
  vec3 maquis = mix(lin(vec3(0.52,0.47,0.36)), lin(vec3(0.20,0.25,0.13)), dots(p, 6., 0.75, 0.38, fw, 9.)*0.9);
  maquis = mix(maquis, lin(vec3(0.70,0.66,0.58)), smoothstep(0.35, 0.6, slope)*0.7);    // limestone
  alb = mix(pc, maquis, wild);
  float pineZone = smoothstep(0.25, 0.45, fbm(p/2200.+8.,3));
  float tCrown, tShadow, tLit;
  acacias(p, 13., clamp(0.85*pineZone + 0.18*wild, 0., 0.9), fw, tCrown, tShadow, tLit);
  alb = mix(alb, mix(lin(vec3(0.10,0.15,0.07)), lin(vec3(0.24,0.30,0.14)), tLit), tCrown);
  occl = 1. - 0.75*tShadow*(1.-tCrown);
  canopy = 0.8*pineZone + 0.3*wild;
  float vil = smoothstep(0.58, 0.63, fbm(p/2600.+vec2(12.,4.),3));
  alb = mix(alb, mix(lin(vec3(0.88,0.86,0.80)), lin(vec3(0.70,0.42,0.30)), step(0.75, hash12(floor(p/8.)))), vil*dots(p, 10., 0.85, 0.40, fw, 5.));
  float rd = riverDist(p);
  alb = mix(alb, lin(vec3(0.80,0.76,0.68)), 1.-smoothstep(0.0025, 0.004, rd));             // gravel bed
  alb = mix(alb, lin(vec3(0.20,0.28,0.12)), (smoothstep(0.0025,0.004,rd)-smoothstep(0.005,0.008,rd))*0.8);   // oleanders
#elif HABITAT == 9
  // ---- steppe: feather grass and wormwood, salt pans, dirt tracks, a few huge ploughed fields
  vec3 grass = mix(lin(vec3(0.76,0.66,0.44)), lin(vec3(0.50,0.50,0.32)), smoothstep(0.2, 0.8, 0.5+0.5*fbm(p/3000.,4)));
  grass = mix(grass, lin(vec3(0.48,0.50,0.40)), smoothstep(0.2, 0.6, fbm(p/900.+4.,3))*0.6);    // wormwood
  grass = mix(grass, lin(vec3(0.62,0.50,0.36)), smoothstep(0.35, 0.7, fbm(p/400.+9.,3))*0.5);  // bare patches
  grass *= 0.9 + 0.2*(0.5+0.5*fbm(p/120.,3))*(1.-smoothstep(4.,30.,fw)) + 0.1*smoothstep(4.,30.,fw);
  grass = mix(grass, lin(vec3(0.82,0.76,0.58)), dots(p, 3., 0.5, 0.3, fw, 7.)*0.35);
  // a few large ploughed fields, irregular and soft-edged, in some regions only
  vec3 vs = voronoi((p + 350.*vec2(snoise(p/5000.), snoise(p/5000.+4.)))/1600.);
  float plough = step(0.8, vs.y) * smoothstep(0.05, 0.3, fbm(p/30000.,2)) * smoothstep(0.0, 0.08, vs.x + 0.03*snoise(p/200.));
  grass = mix(grass, mix(lin(vec3(0.66,0.58,0.42)), lin(vec3(0.55,0.48,0.37)), fract(vs.y*7.)), plough*0.7);
  float salt = smoothstep(uWater+9., uWater+2., vH);
  alb = mix(grass, mix(lin(vec3(0.88,0.86,0.82)), lin(vec3(0.70,0.64,0.54)), 0.5+0.5*fbm(p/200.,2)), salt);
  float tr = abs(snoise(p/5000.+vec2(2.,7.)))*5000./1.6, tr2 = abs(snoise(p/8000.+vec2(9.,1.)))*8000./1.6;
  alb = mix(alb, lin(vec3(0.82,0.74,0.60)), max(lineAA(tr, 3., fw), lineAA(tr2, 3., fw))*0.9);
  shallow = 0.6;
#elif HABITAT == 10
  // ---- taiga in autumn: spruce and pine crowns, golden birch stands, bogs, clear-cuts
  float detail = 1.-smoothstep(3., 14., fw);
  vec3 vc = voronoi(p/6.);
  float crown = 1.-smoothstep(0.35, 0.75, vc.z);
  vec2 sOffT = -uSunDir.xz / max(uSunDir.y, 0.15) * 7.;
  float tShadow = (1.-smoothstep(0.35, 0.75, voronoi((p - sOffT)/6.).z)) * detail;
  float birchZone = smoothstep(0.1, 0.5, fbm(p/1600.+3.,3));
  float isBirch = step(1.-0.7*birchZone*smoothstep(0.2, 0.6, fbm(p/220.+5.,2)+0.5), vc.y);   // birches in groves
  vec3 spruce = mix(lin(vec3(0.11,0.17,0.10)), lin(vec3(0.19,0.26,0.15)), vc.y);
  vec3 birch = mix(lin(vec3(0.60,0.52,0.24)), lin(vec3(0.50,0.40,0.18)), hash12(vec2(vc.y*77.,1.)));
  vec3 forestAvg = mix(lin(vec3(0.13,0.19,0.11)), lin(vec3(0.42,0.36,0.16)), 0.3*birchZone);
  alb = mix(forestAvg, mix(lin(vec3(0.20,0.22,0.12)), mix(spruce, birch, isBirch), crown), detail);
  alb *= 0.85 + 0.3*(0.5+0.5*fbm(p/400.,3));
  float bog = clamp(smoothstep(uWater+6., uWater+1.5, vH)*0.8 + smoothstep(0.45, 0.6, fbm(p/2200.+9.,3))*0.6, 0., 1.);
  vec3 mire = mix(lin(vec3(0.36,0.32,0.16)), lin(vec3(0.28,0.28,0.13)), 0.5+0.5*fbm(p/150.,3));
  mire = mix(mire, lin(vec3(0.58,0.28,0.15)), smoothstep(0.3, 0.7, fbm(p/90.+2.,2))*0.4);   // red sphagnum
  alb = mix(alb, mire, bog);
  water = max(water, smoothstep(0.55, 0.6, fbm(p/110.+4.,3))*step(0.5, bog)*detail);   // bog pools
  vec3 vcut = voronoi((p + 160.*vec2(snoise(p/1800.), snoise(p/1800.+6.)))/650.);
  float cut = step(0.94, vcut.y) * (1.-smoothstep(0.30, 0.42, vcut.z + 0.08*snoise(p/120.))) * (1.-bog);   // clearings
  alb = mix(alb, mix(lin(vec3(0.40,0.36,0.24)), lin(vec3(0.30,0.34,0.18)), 0.5+0.5*fbm(p/80.,2)), cut);
  occl = 1. - 0.5*tShadow*(1.-crown)*(1.-bog)*(1.-cut);
  canopy = (1.-bog)*(1.-cut);
  shallow = 0.15;
#elif HABITAT == 11
  // ---- tundra in autumn: lichen, red dwarf shrubs, moss, ice-wedge polygons, thaw ponds, first snow
  vec3 lichen = mix(lin(vec3(0.56,0.55,0.44)), lin(vec3(0.66,0.64,0.52)), 0.5+0.5*fbm(p/300.,3));
  vec3 shrub = mix(lin(vec3(0.42,0.20,0.11)), lin(vec3(0.54,0.34,0.15)), 0.5+0.5*fbm(p/180.+5.,3));
  alb = mix(lichen, shrub, smoothstep(-0.4, 0.3, fbm(p/1400.+2.,3))*0.85);
  alb = mix(alb, lin(vec3(0.30,0.34,0.17)), smoothstep(0.0, 0.5, fbm(p/700.+7.,3))*0.5);
  alb *= 0.85 + 0.3*(0.5+0.5*fbm(p/60.,3))*(1.-smoothstep(3.,20.,fw)) + 0.15*smoothstep(3.,20.,fw);
  float wedge = (1.-smoothstep(0.02, 0.06, voronoi(p/14.).x))*(1.-smoothstep(1.5, 6., fw));
  alb = mix(alb, lin(vec3(0.24,0.26,0.15)), wedge*0.35*smoothstep(0.1, 0.4, fbm(p/2500.+1.,2)));
  float low = smoothstep(uWater+18., uWater+4., vH);
  water = max(water, smoothstep(0.50, 0.54, fbm(p/260.+vec2(3.,5.),3) + 0.35*low - 0.2) * step(vH, uWater+25.));
  float lee = max(-dot(n.xz, normalize(uSunDir.xz + 1e-4)), 0.);
  alb = mix(alb, lin(vec3(0.92,0.94,0.97)), smoothstep(0.45, 0.6, fbm(p/900.+vec2(4.,4.),3) + 2.5*lee)*0.9);
  alb = mix(alb, lin(vec3(0.55,0.52,0.45)), smoothstep(0.25, 0.45, slope)*0.6);
  shallow = 0.2;
#elif HABITAT == 12
  // ---- Sahel floodplain (Inner Niger delta): channels, reed beds, floating bourgou, levees with villages
  float dry = smoothstep(uWater+2.0, uWater+4.5, vH + 1.5*fbm(p/400.,2));
  vec3 sahel = mix(lin(vec3(0.70,0.58,0.40)), lin(vec3(0.58,0.52,0.32)), 0.5+0.5*fbm(p/1500.,3));
  vec3 reeds = mix(lin(vec3(0.24,0.34,0.12)), lin(vec3(0.36,0.44,0.16)), 0.5+0.5*fbm(p/180.,3));
  alb = mix(reeds, sahel, dry);
  vec2 cs = vec2(70., 45.); vec2 fid = floor((p + 20.*snoise(p/600.))/cs);
  float field = step(0.55, hash12(fid)) * smoothstep(0.2, 0.6, fbm(p/2500.+6.,3)) * dry;
  alb = mix(alb, mix(lin(vec3(0.50,0.50,0.24)), lin(vec3(0.66,0.56,0.34)), hash12(fid+1.)), field);
  float vil = smoothstep(0.6, 0.64, fbm(p/2200.+3.,3))*dry;
  alb = mix(alb, mix(lin(vec3(0.50,0.38,0.28)), lin(vec3(0.66,0.54,0.40)), dots(p, 9., 0.8, 0.35, fw, 8.)), vil);
  float tCrown, tShadow, tLit;
  acacias(p, 28., 0.22*dry*smoothstep(0.1, 0.5, fbm(p/1500.+2.,2)), fw, tCrown, tShadow, tLit);
  alb = mix(alb, mix(lin(vec3(0.12,0.18,0.06)), lin(vec3(0.28,0.34,0.13)), tLit), tCrown);
  occl = 1. - 0.75*tShadow*(1.-tCrown);
  float fmat = step(0.30, fbm(p/600.+vec2(8.,2.),3)) * step(uWater-3.5, vH);
  if(water > 0.5 && fmat > 0.5){ water = 0.; alb = mix(lin(vec3(0.30,0.46,0.14)), lin(vec3(0.42,0.52,0.18)), 0.5+0.5*fbm(p/120.+3.,3)); }
  shallow = 0.4;
#else
  // ---- rainforest canopy: one dome per crown
  vec3 vc = voronoi(p/26.);
  float hs = vc.y;
  float rr = 0.55 + 0.25*hash12(vec2(hs*91.,3.));
  float dome = clamp(1. - (vc.z*vc.z)/(rr*rr), 0., 1.);
  float detail = 1. - smoothstep(4., 18., fw);
  vec3 cg = hs < 0.3 ? lin(vec3(0.16,0.30,0.10)) : hs < 0.6 ? lin(vec3(0.22,0.35,0.12)) : hs < 0.85 ? lin(vec3(0.27,0.38,0.14))
          : hs < 0.96 ? lin(vec3(0.38,0.42,0.18)) : lin(vec3(0.36,0.30,0.18));
  vec3 avgC = lin(vec3(0.22,0.33,0.12));
  // crown normal from the Voronoi distance: the nearer the edge, the steeper
  vec2 g2 = vec2(snoise(p/9.), snoise(p/9.+4.));
  float tilt = (1.-dome);
  vec3 nC = normalize(vec3(g2.x*tilt*1.2 + 0.4*snoise(p/3.), 1., g2.y*tilt*1.2 + 0.4*snoise(p/3.+7.)));
  n = normalize(mix(n, normalize(n + vec3(nC.x, 0., nC.z)), detail));
  float gap = smoothstep(0.85, 1.0, vc.z/rr) * detail;
  alb = mix(avgC, cg*(0.85+0.3*dome), detail*0.6);
  alb *= 1. - 0.6*gap;
  // patchiness at every scale so the far canopy is not a flat green
  float patchv = 0.5 + 0.6*fbm(p/1100.,4) + 0.35*fbm(p/4000.+2.,3);
  alb *= 0.75 + 0.25*(0.5+0.5*fbm(p/220.,3));
  alb = mix(lin(vec3(0.09,0.17,0.06)), alb*1.15, smoothstep(0.1, 0.9, patchv));
  alb = mix(alb, lin(vec3(0.40,0.46,0.20)), dots(p, 110., 0.25, 0.14, fw, 31.)*0.45);   // emergent crowns
  alb = mix(alb, lin(vec3(0.30,0.36,0.14)), smoothstep(0.35, 0.8, fbm(p/2600.+4.,3))*0.45);   // drier/lighter stands
  alb = mix(alb, lin(vec3(0.12,0.22,0.08)), smoothstep(0.2, 0.7, fbm(p/1800.+9.,3))*0.4);    // swamp forest
  float sdist = smoothstep(3., 20., fw);
  alb *= mix(1., 0.82 + 0.18*(0.5+0.5*snoise(p/60.)), sdist);
  float rc = congoRiver(p);
  float bank = 1. - smoothstep(560., 620., rc);
  alb = mix(alb, mix(lin(vec3(0.62,0.52,0.38)), lin(vec3(0.30,0.40,0.16)), smoothstep(290., 294., vH)), bank);
  water = max(water, step(vH, uWater));
  // mist in the valleys
  float valleyH = 385. + 30.*snoise(p/2500.+uTime*0.002);
  mist = uMist * (1.-smoothstep(valleyH-30., valleyH+40., vH)) * smoothstep(0.05, 0.55, fbm(p/1800.+uTime*0.004,3)) * (1.-bank);
#endif
  // ---- fine relief and large-scale variation, common to the land habitats
#if HABITAT == 0
  const float BUMP = 0.5;
#elif HABITAT == 1 || HABITAT == 11
  const float BUMP = 1.0;
#elif HABITAT == 3 || HABITAT == 8 || HABITAT == 10 || HABITAT == 12
  const float BUMP = 0.6;
#elif HABITAT == 9
  const float BUMP = 0.3;
#else
  const float BUMP = 0.;     // Alps and Congo have their own, city and sea none
#endif
  float bk = BUMP * (1.-smoothstep(6., 50., fw)) * (1.-water);
  float ck = canopy * (1.-smoothstep(8., 70., fw)) * (1.-water);
  if(bk + ck > 0.){
    // relief finer than the mesh: undulations and gullies (bk), clumps of tree crowns (ck)
    float e = 4.;
    vec2 q1 = p + vec2(e, 0.), q2 = p + vec2(0., e);
    float b0 = bk*fbm(p/90.,3)  + ck*0.35*fbm(p/24.,2);
    float b1 = bk*fbm(q1/90.,3) + ck*0.35*fbm(q1/24.,2);
    float b2 = bk*fbm(q2/90.,3) + ck*0.35*fbm(q2/24.,2);
    n = normalize(n + 9.*vec3(b0-b1, 0., b0-b2)/e);
    alb *= mix(1., 0.72 + 0.56*(0.5+0.5*fbm(p/30.+vec2(5.,9.),3)), ck);   // lit and shaded crowns
  }
#if HABITAT != 4 && HABITAT != 5
  alb *= 0.86 + 0.28*(0.5+0.5*fbm(p/9000.+vec2(31.,17.),3));   // regional tone, so patterns do not repeat
#endif
  // lighting
  float ndl = max(dot(n, uSunDir), 0.);
  float sh = 1.;
  if(uCloudShadow > 0.){
    float t = (uCloudH - vWorld.y)/max(uSunDir.y, 0.05);
    sh = 1. - uCloudShadow*cloudDens(p + uSunDir.xz*t, 3);
  }
  vec3 col = alb*(uSunCol*ndl*sh*occl + uAmb*(0.55+0.45*n.y)*(0.75+0.25*sh)*(0.85+0.15*occl));
  col = mix(col, vec3(dot(col, vec3(0.3,0.5,0.2)))*vec3(0.85,0.95,1.15), uDesat);   // night vision loses colour
  col += emis;
  if(water > 0.5){
    float t = uTime;
    float damp = 1.-smoothstep(3., 50., fw);
    vec2 g1 = vec2(snoise(p/55.+vec2(t*0.09,0.)), snoise(p/55.+vec2(5.,t*0.08)));
    vec2 g2 = vec2(snoise(p/14.+vec2(-t*0.2,3.)), snoise(p/14.+vec2(9.,t*0.18)));
    vec2 g3 = vec2(snoise(p/320.+vec2(t*0.02,1.)), snoise(p/320.+vec2(2.,-t*0.02)));
    vec2 sl = uWave*(0.10*g3 + 0.10*g1*mix(0.4,1.,damp) + 0.07*g2*damp);
    vec3 wn = normalize(vec3(sl.x, 1., sl.y));
    vec3 rd = reflect(vd, wn); rd.y = abs(rd.y);
    float fres = 0.02 + 0.98*pow(1.-max(dot(-vd, wn),0.), 5.);
    vec3 refl = skyColor(rd) * mix(1., 0.5, step(0.06, uWaterCol.r - uWaterCol.b));   // muddy water looks matte
    float ex = mix(1200., 50., smoothstep(1., 60., fw));
    float spec = pow(max(dot(rd, uSunDir),0.), ex)*(ex+8.)/40.;
    vec3 body = uWaterCol*(uAmb*0.6 + uSunCol*max(uSunDir.y,0.)*0.35);
    body = mix(body, lin(vec3(0.15,0.55,0.52))*(uAmb*0.6 + uSunCol*max(uSunDir.y,0.)*0.5), shallow*0.8);
    col = mix(body, refl, fres) + uSunCol*spec*sh*fres*4.;
    // whitecaps, surf and the ship's wake
    float foam = uFoam * smoothstep(0.55, 0.75, snoise(p/22.+vec2(t*0.35,0.))) * smoothstep(0.0, 0.6, snoise(p/240.+vec2(0.,t*0.04)));
    foam = mix(foam, uFoam*0.04, smoothstep(2., 15., fw));
    foam += smoothstep(-3.5, -0.5, vH) * (0.55 + 0.45*snoise(p/7.+t*0.6)) * surfK;
    if(uShip.w > 0.5){
      vec2 d = p - uShip.xy; float s = -d.y, l = abs(d.x);
      if(s > -60.){
        float sp = max(s, 0.);
        float arm = 1. - smoothstep(0., 5. + sp*0.025, abs(l - sp*0.33));
        float turb = 1. - smoothstep(4. + sp*0.02, 9. + sp*0.04, l);
        float bow = (1. - smoothstep(0., 12., length(vec2(l*0.8, d.y - 65.)))) ;
        foam += (arm*0.6*exp(-sp/700.) + turb*0.9*exp(-sp/1100.)) * step(0., s) * (0.6+0.4*snoise(p/6.+t)) + bow*0.7;
      }
    }
    foam = clamp(foam, 0., 1.);
    col = mix(col, lin(vec3(0.92,0.94,0.96))*(uSunCol*max(uSunDir.y,0.)*0.8 + uAmb), foam*0.9);
    col += waterEmis;
  }
  if(uSeaFog > 0.){   // soft contact where slopes dip into a sea of fog
    float k = 1.-smoothstep(uCloudH-40., uCloudH+220.+60.*snoise(p/700.+uTime*0.01), vWorld.y);
    col = mix(col, uSeaFogCol*(0.8+0.2*ndl), k*uSeaFog);
  }
  if(mist > 0.) col = mix(col, (uSunCol*0.55 + uAmb*0.9), mist*0.85);
  float fogF = fogAmount(dist, uCam.y, vWorld.y);
  col = mix(col, skyColor(vd), fogF);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- sky dome
export const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize((modelMatrix*vec4(position,1.)).xyz - cameraPosition);
  vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.);
  gl_Position = p.xyww;
}
`;
export const SKY_FS = NOISE + SKY + /* glsl */ `
uniform float uEnv; uniform vec3 uEnvGround; uniform float uSunDisc;
uniform vec3 uMoonDir; uniform vec3 uMoonCol; uniform float uMilky;
varying vec3 vDir;
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise3(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x), f.y), f.z);
}
float fbm3(vec3 p){ float s=0., a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise3(p); p=p*2.1+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  vec3 c = skyColor(d);
  if(uEnv > 0.5){
    c = mix(c, uEnvGround, smoothstep(0.02, -0.2, d.y));
  } else {
    float mu = dot(d, uSunDir);
    c += uSunCol * uSunDisc * smoothstep(0.99996, 0.99999, mu);
    float mm = dot(d, uMoonDir);
    float moon = smoothstep(0.99993, 0.99996, mm);
    // a little shading on the moon disc
    c += uMoonCol * (moon*(0.85+0.15*vnoise3(d*4000.)) + pow(max(mm,0.),2000.)*0.08 + pow(max(mm,0.),80.)*0.015);
    if(uMilky > 0.){
      vec3 gn = normalize(vec3(0.45, 0.35, -0.82));
      float b = dot(d, gn);
      float n = fbm3(d*5.);
      float band = exp(-b*b/0.035) * (0.25+1.2*n*n) + 0.25*exp(-b*b/0.15)*n;
      float lane = exp(-pow(b+0.015,2.)/0.004) * smoothstep(0.35, 0.65, fbm3(d*7.+3.));
      float mw = max(band - 0.9*lane, 0.);
      c += uMilky * mw * vec3(0.55,0.58,0.75) * smoothstep(0.0, 0.25, d.y);
    }
  }
  gl_FragColor = vec4(c, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- stars
export const STAR_VS = /* glsl */ `
attribute float aMag; attribute vec3 aCol;
uniform float uStars; uniform float uTime; uniform float uPx;
varying vec3 vCol;
void main(){
  vec3 d = normalize(position);
  float tw = 0.85 + 0.15*sin(uTime*3. + aMag*91.7);
  float ext = smoothstep(-0.01, 0.25, d.y);
  vCol = aCol * uStars * pow(2.512, -aMag) * 10. * tw * ext;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * d * 1000., 1.);
  gl_Position = p.xyww;
  gl_PointSize = uPx * (aMag < 1.5 ? 2.6 : 1.8);
}
`;
export const STAR_FS = /* glsl */ `
varying vec3 vCol;
void main(){
  float r = length(gl_PointCoord-0.5)*2.;
  float a = exp(-r*r*4.);
  gl_FragColor = vec4(vCol*a, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- cloud layer
export const CLOUD_VS = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position,1.);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const CLOUD_FS = NOISE + SKY + /* glsl */ `
uniform float uCov; uniform float uScale; uniform vec2 uWindC; uniform vec2 uStretch;
uniform vec3 uLit; uniform vec3 uShade; uniform float uOpacity; uniform float uThick; uniform vec3 uUnder;
varying vec3 vWorld;
float dens(vec2 p, int oct){
  vec2 q = (p + uWindC*uTime)/uScale; q *= uStretch;
  float n = fbm(q, oct)*0.5+0.5;
  return smoothstep(1.-uCov, 1.-uCov+uThick, n);
}
void main(){
  vec2 p = vWorld.xz;
  vec3 V = vWorld - uCam; float dist = length(V); vec3 vd = V/dist;
  float d = dens(p, 6);
  if(d < 0.003) discard;
  // light from the sun side: density a bit towards the sun darkens
  vec2 toSun = normalize(uSunDir.xz + 1e-4) * uScale * 0.06;
  float d2 = dens(p + toSun, 4);
  float lit = clamp(1. - 1.1*max(d2 - d*0.6, 0.), 0., 1.);
  bool below = uCam.y < vWorld.y;
  vec3 c = mix(uShade, uLit, lit);
  if(below){ c = mix(uUnder, c*0.75, 0.35*(1.-d)); }
  float mu = max(dot(vd, uSunDir),0.);
  c += uLit * pow(mu, 12.) * (1.-d) * 0.8;   // silver lining against the sun
  float a = d * uOpacity;
  float grazing = abs(vd.y);
  a *= smoothstep(0.0, 0.05, grazing);
  float f = fogAmount(dist, uCam.y, vWorld.y);
  c = mix(c, skyColor(vd), f);
  a *= 1. - smoothstep(0.75, 1., f);
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- distant birds
export const FLOCK_VS = NOISE + SKY + /* glsl */ `
attribute float aPhase;
uniform float uFlap; uniform float uGlide;
varying vec3 vWorld;
void main(){
  vec3 pos = position;
  float ph = uTime*uFlap + aPhase*6.2831;
  float glide = smoothstep(0.2, 0.8, sin(uTime*0.3 + aPhase*12.)*0.5+0.5) * uGlide;
  pos.y += abs(pos.x) * 0.55 * sin(ph) * (1.-glide);
  vec4 wp = modelMatrix * instanceMatrix * vec4(pos, 1.);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const FLOCK_FS = NOISE + SKY + /* glsl */ `
uniform vec3 uBirdCol;
varying vec3 vWorld;
void main(){
  vec3 V = vWorld - uCam; float dist = length(V); vec3 vd = V/dist;
  vec3 c = uBirdCol;
  float f = 1. - exp(-dist/9000.);
  c = mix(c, skyColor(vd), f);
  gl_FragColor = vec4(c, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- rain streaks (around the camera)
export const RAIN_VS = /* glsl */ `
attribute vec3 aOff; attribute float aEnd;
uniform float uTime; uniform vec3 uCam; uniform float uBox; uniform vec3 uFall;
varying float vA;
void main(){
  vec3 o = aOff + uFall*uTime;
  o = mod(o - uCam + uBox*0.5, uBox) - uBox*0.5;  // wrap in a box around the camera
  vec3 wp = uCam + o + uFall*0.035*aEnd;
  vA = (1.-smoothstep(uBox*0.25, uBox*0.5, length(o)));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp,1.);
}
`;
export const RAIN_FS = /* glsl */ `
uniform vec3 uRainCol; varying float vA;
void main(){ gl_FragColor = vec4(uRainCol, vA*0.35); }
`;

// ---------------------------------------------------------------- cumulus towers (camera-facing puffs)
export const CUMULUS_VS = /* glsl */ `
attribute vec4 aPuff;   // world centre xyz, radius
attribute vec4 aTower;  // base altitude, top altitude, seed, unused
varying vec2 vUv; varying vec3 vWorld; varying vec4 vTower;
void main(){
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vUv = position.xy*2.;
  vTower = aTower;
  vec3 wp = aPuff.xyz + (right*position.x + up*position.y)*2.*aPuff.w;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
}
`;
export const CUMULUS_FS = NOISE + SKY + /* glsl */ `
uniform vec3 uCuLit; uniform vec3 uCuShade; uniform float uCuOpacity;
varying vec2 vUv; varying vec3 vWorld; varying vec4 vTower;
void main(){
  float r = length(vUv);
  float nz = fbm(vUv*1.6 + vTower.z*13.1, 4);
  float a = 1. - smoothstep(0.45, 0.95, r + 0.35*nz);
  a *= smoothstep(vTower.x - 30., vTower.x + 60., vWorld.y);      // flat bases
  if(a < 0.01) discard;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 fwd = normalize(cameraPosition - vWorld);
  vec2 q = vUv + 0.35*vec2(nz, fbm(vUv*1.6 + 5. + vTower.z*7.,3));
  vec3 nw = normalize(right*q.x + up*q.y + fwd*sqrt(max(1. - dot(q,q)*0.8, 0.05)));
  float lam = clamp(dot(nw, uSunDir)*0.6 + 0.45, 0., 1.);
  float hgt = smoothstep(vTower.x, mix(vTower.x, vTower.y, 0.6), vWorld.y);
  vec3 c = mix(uCuShade, uCuLit, lam) * mix(0.62, 1.0, hgt);
  vec3 vd = -fwd; float dist = length(vWorld - cameraPosition);
  c += uCuLit * 0.5 * pow(max(dot(vd, uSunDir), 0.), 8.) * (1.-a);    // silver lining
  float f = fogAmount(dist, uCam.y, vWorld.y);
  c = mix(c, skyColor(vd), f);
  a *= uCuOpacity * (1. - smoothstep(0.8, 1., f));
  gl_FragColor = vec4(c*a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- simple lit solids (the ship)
export const SOLID_VS = /* glsl */ `
varying vec3 vN; varying vec3 vWorld;
void main(){
  vN = normalize(mat3(modelMatrix)*normal);
  vec4 wp = modelMatrix*vec4(position,1.); vWorld = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}
`;
export const SOLID_FS = NOISE + SKY + /* glsl */ `
uniform vec3 uColor;
varying vec3 vN; varying vec3 vWorld;
void main(){
  vec3 n = normalize(vN);
  vec3 c = uColor*(uSunCol*max(dot(n,uSunDir),0.) + uAmb*(0.6+0.4*n.y));
  vec3 V = vWorld - uCam; float dist = length(V);
  c = mix(c, skyColor(V/dist), fogAmount(dist, uCam.y, vWorld.y));
  gl_FragColor = vec4(c,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- city lights as points (near field)
// A lattice of candidate lights that follows the camera; each one switches on when it sits on a
// street (street lamp) or, at random, in a built-up block (house light). Point sprites keep tiny,
// bright lights visible as sparkles instead of averaging them away.
export const CITYPTS_VS = NOISE + SKY + `#define HABITAT 4
` + HABITATS + /* glsl */ `
attribute vec2 aGrid;
uniform vec2 uSnap; uniform float uStep; uniform float uPx; uniform float uLights; uniform vec4 uFade;   // fade in from x..y, out from z..w
varying vec3 vCol;
void main(){
  vec2 id = floor(uSnap/uStep) + aGrid;
  vec2 p = (id + 0.15 + 0.7*hash22(id*1.37))*uStep;
  float dist = length(p - uCam.xz);
  float u = cityDensity(p);
  float land = smoothstep(0.0, 0.03, coast(p)) * smoothstep(130., 160., cityRiver(p));
  vCol = vec3(0.);
  gl_PointSize = 0.; gl_Position = vec4(2., 2., 2., 1.);
  if(u*land < 0.04 || dist > uFade.w || dist < uFade.x) return;
  float dLoc, dArt, hood; cityRoads(p, u, dLoc, dArt, hood);
  float r = hash12(id*0.71+5.);
  float coreK = smoothstep(0.45, 0.9, u);
  vec3 sodium = vec3(1.0, 0.52, 0.16), led = vec3(0.82, 0.88, 1.0), warm = vec3(1.0, 0.78, 0.52);
  float b = 0.;
  vec3 c = sodium;
  if(dArt < 9.) { b = 1.6; c = mix(sodium, warm, coreK); }
  else if(dLoc < 6.) { b = (r < 0.8 ? 1. : 0.); c = mix(sodium, mix(warm, led, step(0.65, hood)), coreK*0.8); }
  else if(r < 0.06 + 0.30*u*u) { b = 0.35 + 0.5*hash12(id+9.); c = mix(warm, led, step(0.7, hash12(id+2.))*coreK); }
  float park = smoothstep(0.15, -0.15, fbm(p/1300.+vec2(9.,3.),3));
  b *= u > 0.12 ? 1. : u/0.12;
  b *= (1. - park*0.85) * land * uLights;
  if(b < 0.01) return;
  float y = terrainHeight(p) + 4.;
  vec2 dd = p - uCam.xz; y -= dot(dd,dd)/(2.*6371000.);
  vec4 wp = vec4(p.x, y, p.y, 1.);
  gl_Position = projectionMatrix * viewMatrix * wp;
  float f = fogAmount(dist, uCam.y, y);
  // point sources: once smaller than a pixel they get dimmer with distance, not smaller
  float att = min(1., pow(1500./max(dist, 1.), 1.5)) * smoothstep(uFade.x, uFade.y, dist) * (1. - smoothstep(uFade.z, uFade.w, dist));
  vCol = c * b * 16. * sqrt(uStep/12.) * att * (1. - f);
  gl_PointSize = uPx * mix(3.0, 1.8, smoothstep(800., 4000., dist));
}
`;
export const CITYPTS_FS = /* glsl */ `
varying vec3 vCol;
void main(){
  float r = length(gl_PointCoord - 0.5)*2.;
  gl_FragColor = vec4(vCol * exp(-r*r*3.), 1.);
}
`;
