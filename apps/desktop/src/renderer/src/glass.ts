import type { Style } from './presence'

/**
 * Fluted glass in front of the presence, as tuned by eye in a prototype. Lengths are CSS pixels;
 * the strip settings are fractions of a strip's width.
 */
const GLASS = {
  /** Direction the strips run, in degrees clockwise from the horizontal. */
  angle: 52,
  width: 110,
  /** How uneven the strips are: 0 is a regular comb. */
  widthVar: 1.2,
  /** Lens bend across a strip: what's behind is squeezed and flipped. */
  refract: 0.5,
  /** Each strip shows its own slice of the scene, shifted across and along it: the hard seams. */
  slice: 0.3,
  sliceAlong: 0.5,
  /** Light smeared along the strips. */
  smear: 20,
  /** A glint on one edge of each strip, a groove on the other. */
  highlight: 0.6,
  shade: 0.25,
  /** Colours bending by different amounts. */
  chroma: 0.2,
  grain: 0.2,
  /** Softness of the scene behind the glass, in aurora cells. */
  softness: 2.5,
  /** A faint glow behind the glass, so it reads even when the aurora is quiet. */
  glow: 0.2,
  glowSize: 0.5,
}

/** One frame of the aurora: premultiplied on upload, `cell` CSS pixels per texel. */
export interface Scene {
  image: ImageData
  cell: number
  time: number
  /** 0: the aurora is centred. 1: docked at the bottom edge. */
  dock: number
  /** 0: dark theme, the aurora is light in the dark. 1: light theme, it tints the glass like ink. */
  light: number
  style: Style
  /** RGB of the aurora's colors, up the curtain: the bottom fringe, the middle and the crown. */
  colors: Uint8ClampedArray
}

const f = (n: number) => n.toFixed(4)

const VERT = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`

// Blurs the coarse aurora, one axis per pass. The second pass also lays in the glow, so the glass
// always has some light behind it to bend.
const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize, uStep;
uniform float uGlow, uTime, uDock, uAspect, uLight;
uniform vec3 uC0, uC1, uC2;
out vec4 o;

vec3 glow(vec2 uv) {
  vec2 a = vec2(uAspect, 1.0), q = uv * a;
  float base = mix(0.55, 0.95, uDock);
  vec3 c = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float i = float(k);
    vec2 at = vec2((0.5 + 0.34 * sin(uTime * 0.07 + i * 2.1)) * a.x, base + 0.16 * cos(uTime * 0.05 + i * 1.7) - 0.08 * i);
    float r = ${f(GLASS.glowSize)} * (0.75 + 0.3 * i);
    c += exp(-dot(q - at, q - at) / (r * r)) * (k == 0 ? uC1 : k == 1 ? uC2 : uC0);
  }
  return c * uGlow * 0.45;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 c = vec4(0.0);
  float ws = 0.0;
  for (int k = -6; k <= 6; k++) {
    float t = float(k) / 6.0, w = exp(-t * t * 3.0);
    c += texture(uTex, uv + uStep * t) * w;
    ws += w;
  }
  c /= ws;
  if (uGlow > 0.0) {
    // Dark, the glow is light added to the background; light, it is a tint laid over it.
    vec3 g = glow(uv);
    c += vec4(g, uLight * max(g.r, max(g.g, g.b)));
  }
  o = c;
}`

// Space is turned so x runs across the strips and y along them. Each strip bends what's behind it
// like a lens and shows its own slice of the scene, so the seams are sharp while the light is soft.
const PANE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uRes, uSpan;
uniform float uDpr, uTime, uLight;
out vec4 o;

const float ANGLE = ${f((GLASS.angle * Math.PI) / 180)};
// The window background per theme: the theme's --background.
const vec3 DARK = vec3(${f(10 / 255)}, ${f(10 / 255)}, ${f(11 / 255)});
const vec3 LIGHT = vec3(${f(242 / 255)}, ${f(242 / 255)}, ${f(244 / 255)});

float hash11(float n) { return fract(sin(n * 127.1 + 3.7) * 43758.5453); }
// Per pixel, a float hash makes a pattern on the pixel grid; an integer one (pcg2d) is noise.
float noise(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return float(v.x) / 4294967296.0;
}

void main() {
  vec2 pix = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 along = vec2(cos(ANGLE), sin(ANGLE)), across = vec2(-along.y, along.x);
  float W = ${f(GLASS.width)} * uDpr;
  float px = dot(pix - uRes * 0.5, across);
  // Uneven widths: the across axis is warped smoothly, and stays monotonic so strips never fold.
  float x = px + ${f(GLASS.widthVar)} * W * (0.35 * sin(px / (W * 2.3)) + 0.2 * sin(px / (W * 0.97) + 1.3));
  float i = floor(x / W), s = fract(x / W) - 0.5;
  float bend = -${f(GLASS.refract)} * W * 2.0 * s;
  float shift = (hash11(i) - 0.5) * ${f(GLASS.slice)} * W * 2.0;
  vec2 slide = along * (hash11(i + 31.7) - 0.5) * ${f(GLASS.sliceAlong)} * W * 2.0;
  vec2 ofs = across * (bend + shift) + slide;
  vec2 ofsR = across * (bend * ${f(1 + GLASS.chroma)} + shift) + slide;
  vec2 ofsB = across * (bend * ${f(1 - GLASS.chroma)} + shift) + slide;

  vec3 col = vec3(0.0);
  float a = 0.0, ws = 0.0;
  for (int k = 0; k < 9; k++) {
    float t = (float(k) - 4.0) / 4.0, w = exp(-t * t * 2.0);
    vec2 sm = along * t * ${f(GLASS.smear)} * uDpr;
    vec4 c = texture(uScene, (pix + ofs + sm) / uSpan);
    c.r = texture(uScene, (pix + ofsR + sm) / uSpan).r;
    c.b = texture(uScene, (pix + ofsB + sm) / uSpan).b;
    col += c.rgb * w;
    a += c.a * w;
    ws += w;
  }
  col /= ws;
  a /= ws;

  // Light gathers toward one side of each strip: a thin glint on that edge, a soft groove on the other.
  col *= clamp(1.0 + ${f(GLASS.shade)} * 1.2 * s, 0.0, 2.0);
  col *= 1.0 - ${f(GLASS.shade)} * 0.8 * exp(-(s + 0.5) * W / (2.5 * uDpr));
  col += ${f(GLASS.highlight)} * exp(-(0.5 - s) * W / (1.2 * uDpr)) * col * 1.6;

  // The scene is premultiplied light over the window background; grain moves at film rate.
  vec3 c = mix(DARK, LIGHT, uLight) * (1.0 - a) + col;
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  uvec2 at = uvec2(gl_FragCoord.xy);
  c += (noise(at + uint(uTime * 24.0) * uvec2(7919u, 104729u)) - 0.5) * ${f(GLASS.grain)} * (0.12 + sqrt(max(lum, 0.0)));
  c += (noise(at + uvec2(65537u, 3u)) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`

/** Draws the aurora behind the glass on `canvas`, which it takes over. */
export function glass(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' })
  if (!gl) throw new Error('WebGL2 is unavailable')
  // Half floats keep the dim glow from banding; 8 bits still works, with the dither doing more of the work.
  const halfFloat = !!gl.getExtension('EXT_color_buffer_float')

  const shaders: WebGLShader[] = []
  const program = (fs: string) => {
    const p = gl.createProgram()
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fs]] as const) {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader failed to compile')
      gl.attachShader(p, sh)
      shaders.push(sh)
    }
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program failed to link')
    const at: Record<string, WebGLUniformLocation | null> = {}
    return { p, u: (name: string) => (at[name] ??= gl.getUniformLocation(p, name)) }
  }
  const blur = program(BLUR)
  const pane = program(PANE)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)

  const texture = () => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  const scene = texture()
  const passes = [0, 1].map(() => ({ tex: texture(), fbo: gl.createFramebuffer() }))
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.activeTexture(gl.TEXTURE0)

  /** Size of the blur targets, which follow the aurora's buffer. */
  let bw = 0, bh = 0, dpr = 1
  const allocate = (w: number, h: number) => {
    bw = w
    bh = h
    for (const { tex, fbo } of passes) {
      gl.bindTexture(gl.TEXTURE_2D, tex)
      if (halfFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    }
  }
  const draw = (fbo: WebGLFramebuffer | null, w: number, h: number) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, w, h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  return {
    /** Sizes the canvas to `width`×`height` CSS pixels. */
    resize(width: number, height: number, ratio: number) {
      dpr = ratio
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
    },

    draw({ image, cell, time, dock, light, style: p, colors: rgb }: Scene) {
      if (image.width !== bw || image.height !== bh) allocate(image.width, image.height)
      gl.bindTexture(gl.TEXTURE_2D, scene)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)

      // The glow takes the aurora's colors, and brightens a little as the aurora does.
      const radius = GLASS.softness + p.blur * 0.02
      gl.useProgram(blur.p)
      gl.uniform1i(blur.u('uTex'), 0)
      gl.uniform2f(blur.u('uSize'), bw, bh)
      gl.uniform1f(blur.u('uTime'), time)
      gl.uniform1f(blur.u('uDock'), dock)
      gl.uniform1f(blur.u('uAspect'), bw / bh)
      gl.uniform1f(blur.u('uLight'), light)
      gl.uniform3f(blur.u('uC0'), rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255)
      gl.uniform3f(blur.u('uC1'), rgb[3]! / 255, rgb[4]! / 255, rgb[5]! / 255)
      gl.uniform3f(blur.u('uC2'), rgb[6]! / 255, rgb[7]! / 255, rgb[8]! / 255)
      gl.uniform2f(blur.u('uStep'), radius / bw, 0)
      gl.uniform1f(blur.u('uGlow'), 0)
      draw(passes[0]!.fbo, bw, bh)
      gl.bindTexture(gl.TEXTURE_2D, passes[0]!.tex)
      gl.uniform2f(blur.u('uStep'), 0, radius / bh)
      gl.uniform1f(blur.u('uGlow'), GLASS.glow * (0.55 + 0.45 * Math.min(1, p.alpha * 1.6)))
      draw(passes[1]!.fbo, bw, bh)

      gl.useProgram(pane.p)
      gl.bindTexture(gl.TEXTURE_2D, passes[1]!.tex)
      gl.uniform1i(pane.u('uScene'), 0)
      gl.uniform2f(pane.u('uRes'), canvas.width, canvas.height)
      gl.uniform2f(pane.u('uSpan'), bw * cell * dpr, bh * cell * dpr)
      gl.uniform1f(pane.u('uDpr'), dpr)
      gl.uniform1f(pane.u('uTime'), time)
      gl.uniform1f(pane.u('uLight'), light)
      draw(null, canvas.width, canvas.height)
    },

    dispose() {
      for (const { tex, fbo } of passes) {
        gl.deleteTexture(tex)
        gl.deleteFramebuffer(fbo)
      }
      gl.deleteTexture(scene)
      for (const sh of shaders) gl.deleteShader(sh)
      gl.deleteProgram(blur.p)
      gl.deleteProgram(pane.p)
      gl.deleteVertexArray(vao)
    },
  }
}
