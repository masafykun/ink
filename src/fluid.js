// INK — WebGL2 GPU fluid solver.
// A compact, commented stable-fluids implementation: every simulation step is a
// sequence of fragment-shader passes ping-ponging between float framebuffers.
import {
  baseVert, clearFrag, splatFrag, advectionFrag, divergenceFrag, curlFrag,
  vorticityFrag, pressureFrag, gradientSubtractFrag, displayFrag,
} from './shaders.js';

export function startFluid(canvas, overrides = {}) {
  const config = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 1024,
    DENSITY_DISSIPATION: 0.72,   // lower = ink lingers longer
    VELOCITY_DISSIPATION: 0.28,  // higher = currents calm down sooner
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 30,                    // vorticity / swirliness
    SPLAT_RADIUS: 0.35,
    SPLAT_FORCE: 3800,
    BACKGROUND: [0.012, 0.012, 0.026],
    ...overrides,
  };

  const gl = canvas.getContext('webgl2', {
    alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 not supported');
  gl.getExtension('EXT_color_buffer_float');
  const supportLinearFloat = !!gl.getExtension('OES_texture_float_linear');

  // ---- format selection ----
  function getSupportedFormat(internalFormat, format, type) {
    if (!supportRenderTextureFormat(internalFormat, format, type)) {
      switch (internalFormat) {
        case gl.R16F:    return getSupportedFormat(gl.RG16F, gl.RG, type);
        case gl.RG16F:   return getSupportedFormat(gl.RGBA16F, gl.RGBA, type);
        default:         return null;
      }
    }
    return { internalFormat, format };
  }
  function supportRenderTextureFormat(internalFormat, format, type) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok;
  }

  const texType = gl.HALF_FLOAT;
  const rgba = getSupportedFormat(gl.RGBA16F, gl.RGBA, texType);
  const rg   = getSupportedFormat(gl.RG16F, gl.RG, texType);
  const r    = getSupportedFormat(gl.R16F, gl.RED, texType);
  const filtering = supportLinearFloat ? gl.LINEAR : gl.NEAREST;

  // ---- shader / program plumbing ----
  function compile(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) + '\n' + source);
    }
    return s;
  }
  const baseVertShader = compile(gl.VERTEX_SHADER, baseVert);

  class Program {
    constructor(fragSource) {
      this.program = gl.createProgram();
      gl.attachShader(this.program, baseVertShader);
      gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, fragSource));
      gl.bindAttribLocation(this.program, 0, 'aPosition');
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(this.program));
      }
      this.uniforms = {};
      const count = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
        const name = gl.getActiveUniform(this.program, i).name;
        this.uniforms[name] = gl.getUniformLocation(this.program, name);
      }
    }
    bind() { gl.useProgram(this.program); }
  }

  const programs = {
    clear: new Program(clearFrag),
    splat: new Program(splatFrag),
    advection: new Program(advectionFrag),
    divergence: new Program(divergenceFrag),
    curl: new Program(curlFrag),
    vorticity: new Program(vorticityFrag),
    pressure: new Program(pressureFrag),
    gradient: new Program(gradientSubtractFrag),
    display: new Program(displayFrag),
  };

  // ---- fullscreen quad + blit ----
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  function blit(target) {
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // ---- framebuffer objects ----
  function createFBO(w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture, fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }
  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
      get read() { return fbo1; },
      set read(v) { fbo1 = v; },
      get write() { return fbo2; },
      set write(v) { fbo2 = v; },
      swap() { const t = fbo1; fbo1 = fbo2; fbo2 = t; },
    };
  }

  function getResolution(resolution) {
    let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(resolution);
    const max = Math.round(resolution * aspect);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: max, height: min }
      : { width: min, height: max };
  }

  let dye, velocity, divergence, curl, pressure;
  function initFramebuffers() {
    const simRes = getResolution(config.SIM_RESOLUTION);
    const dyeRes = getResolution(config.DYE_RESOLUTION);
    dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
  }

  // ---- simulation step ----
  function step(dt) {
    gl.disable(gl.BLEND);

    programs.curl.bind();
    gl.uniform2f(programs.curl.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.curl.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    programs.vorticity.bind();
    gl.uniform2f(programs.vorticity.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.vorticity.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.vorticity.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(programs.vorticity.uniforms.curl, config.CURL);
    gl.uniform1f(programs.vorticity.uniforms.dt, dt);
    blit(velocity.write); velocity.swap();

    programs.divergence.bind();
    gl.uniform2f(programs.divergence.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.divergence.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    programs.clear.bind();
    gl.uniform1i(programs.clear.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(programs.clear.uniforms.value, config.PRESSURE);
    blit(pressure.write); pressure.swap();

    programs.pressure.bind();
    gl.uniform2f(programs.pressure.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.pressure.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(programs.pressure.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write); pressure.swap();
    }

    programs.gradient.bind();
    gl.uniform2f(programs.gradient.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.gradient.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(programs.gradient.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();

    programs.advection.bind();
    gl.uniform2f(programs.advection.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.advection.uniforms.uSource, velocity.read.attach(0));
    gl.uniform1f(programs.advection.uniforms.dt, dt);
    gl.uniform1f(programs.advection.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write); velocity.swap();

    gl.uniform2f(programs.advection.uniforms.texelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.advection.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(programs.advection.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write); dye.swap();
  }

  function render() {
    programs.display.bind();
    gl.uniform2f(programs.display.uniforms.texelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(programs.display.uniforms.uTexture, dye.read.attach(0));
    gl.uniform3f(programs.display.uniforms.uBackground, ...config.BACKGROUND);
    blit(null);
  }

  // ---- splats ----
  function correctRadius(radius) {
    const aspect = canvas.width / canvas.height;
    return aspect > 1 ? radius * aspect : radius;
  }
  function splat(x, y, dx, dy, color) {
    programs.splat.bind();
    gl.uniform1i(programs.splat.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(programs.splat.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(programs.splat.uniforms.point, x, y);
    gl.uniform3f(programs.splat.uniforms.color, dx, dy, 0);
    gl.uniform1f(programs.splat.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100));
    blit(velocity.write); velocity.swap();

    gl.uniform1i(programs.splat.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(programs.splat.uniforms.color, color.r, color.g, color.b);
    blit(dye.write); dye.swap();
  }
  function multipleSplats(amount) {
    for (let i = 0; i < amount; i++) {
      const color = generateColor();
      color.r *= 8; color.g *= 8; color.b *= 8;
      const x = Math.random();
      const y = Math.random();
      // gentle velocity so the blobs linger instead of blowing themselves out
      const dx = 320 * (Math.random() - 0.5);
      const dy = 320 * (Math.random() - 0.5);
      splat(x, y, dx, dy, color);
    }
  }

  // Ambient drift: a gentle coloured puff now and then so the canvas is always
  // alive and inviting, even when nobody is interacting.
  function ambientSplat() {
    const c = HSVtoRGB(autoHue, 1.0, 1.0);
    const color = { r: c.r * 4, g: c.g * 4, b: c.b * 4 };
    const x = 0.1 + Math.random() * 0.8;
    const y = 0.1 + Math.random() * 0.8;
    const ang = Math.random() * Math.PI * 2;
    const sp = 180;
    splat(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, color);
  }

  // ---- colour ----
  function HSVtoRGB(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return { r: v, g: t, b: p };
      case 1: return { r: q, g: v, b: p };
      case 2: return { r: p, g: v, b: t };
      case 3: return { r: p, g: q, b: v };
      case 4: return { r: t, g: p, b: v };
      default: return { r: v, g: p, b: q };
    }
  }
  function generateColor() {
    const c = HSVtoRGB(Math.random(), 1.0, 1.0);
    c.r *= 0.15; c.g *= 0.15; c.b *= 0.15;
    return c;
  }

  // ---- pointers ----
  function makePointer() {
    return {
      id: -1, down: false, moved: false,
      texcoordX: 0, texcoordY: 0, prevX: 0, prevY: 0, deltaX: 0, deltaY: 0,
      color: generateColor(),
    };
  }
  const pointers = [makePointer()];

  function rectPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
  }
  function updateMove(p, x, y, w, h) {
    p.prevX = p.texcoordX; p.prevY = p.texcoordY;
    p.texcoordX = x / w;
    p.texcoordY = 1 - y / h;
    const aspect = canvas.width / canvas.height;
    let dX = p.texcoordX - p.prevX;
    let dY = p.texcoordY - p.prevY;
    if (aspect < 1) dX *= aspect;
    if (aspect > 1) dY /= aspect;
    p.deltaX = dX; p.deltaY = dY;
    p.moved = Math.abs(dX) > 0 || Math.abs(dY) > 0;
  }

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers[0];
    const { x, y, w, h } = rectPos(e);
    updateMove(p, x, y, w, h);
  });
  canvas.addEventListener('pointerdown', (e) => {
    const p = pointers[0];
    p.down = true;
    p.color = generateColor();
    p.color.r *= 10; p.color.g *= 10; p.color.b *= 10;
    const { x, y, w, h } = rectPos(e);
    p.texcoordX = x / w; p.texcoordY = 1 - y / h;
    p.prevX = p.texcoordX; p.prevY = p.texcoordY;
  });
  window.addEventListener('pointerup', () => { pointers[0].down = false; });
  // touch: multiple fingers
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    for (let i = 0; i < e.targetTouches.length; i++) {
      const t = e.targetTouches[i];
      const p = pointers[i] || (pointers[i] = makePointer());
      updateMove(p, t.clientX - rect.left, t.clientY - rect.top, rect.width, rect.height);
    }
  }, { passive: false });
  canvas.addEventListener('touchstart', (e) => {
    const rect = canvas.getBoundingClientRect();
    for (let i = 0; i < e.targetTouches.length; i++) {
      const t = e.targetTouches[i];
      const p = pointers[i] || (pointers[i] = makePointer());
      p.color = generateColor(); p.color.r *= 10; p.color.g *= 10; p.color.b *= 10;
      p.texcoordX = (t.clientX - rect.left) / rect.width;
      p.texcoordY = 1 - (t.clientY - rect.top) / rect.height;
      p.prevX = p.texcoordX; p.prevY = p.texcoordY;
    }
  }, { passive: false });

  let autoHue = 0;
  let ambientTimer = 0;
  function applyInputs() {
    for (const p of pointers) {
      if (p.moved) {
        p.moved = false;
        // hover-stir (no button held) cycles through a gentle rainbow so the
        // fluid reacts vividly to plain mouse movement, Active-Theory style
        if (!p.down) {
          const c = HSVtoRGB(autoHue, 1.0, 1.0);
          p.color = { r: c.r * 1.3, g: c.g * 1.3, b: c.b * 1.3 };
        }
        splat(p.texcoordX, p.texcoordY, p.deltaX * config.SPLAT_FORCE, p.deltaY * config.SPLAT_FORCE, p.color);
        if (onActivity) onActivity();
      }
    }
  }

  // ---- resize / loop ----
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      return true;
    }
    return false;
  }
  window.addEventListener('resize', () => { if (resize()) initFramebuffers(); });

  let lastTime = performance.now();
  let onActivity = null;
  function frame(now) {
    let dt = (now - lastTime) / 1000;
    dt = Math.min(dt, 0.016666);
    lastTime = now;
    autoHue = (autoHue + 0.003) % 1;
    if (resize()) initFramebuffers();
    applyInputs();
    ambientTimer += dt;
    if (ambientTimer > 0.5) { ambientTimer = 0; ambientSplat(); }
    step(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---- boot ----
  resize();
  initFramebuffers();
  multipleSplats(Math.floor(Math.random() * 8) + 8);
  requestAnimationFrame(frame);

  return {
    config,
    burst: (n = 6) => multipleSplats(n),
    onActivity: (cb) => { onActivity = cb; },
  };
}
