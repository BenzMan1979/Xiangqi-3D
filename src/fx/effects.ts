import * as THREE from 'three';
import { Stage } from '../render/stage';
import { tween } from '../render/tween';

/** Effect strength chosen in settings. */
export type FxLevel = 'full' | 'reduced' | 'off';

export interface EmitOptions {
  at: THREE.Vector3;
  count: number;
  /** Initial speed range (world units/s). */
  speed: [number, number];
  /** Preferred direction; omitted means all directions. */
  dir?: THREE.Vector3;
  /** Cone half-angle around `dir`, radians. */
  spread?: number;
  /** Random offset radius around `at`. */
  jitter?: number;
  life: [number, number];
  size: [number, number];
  /** Size multiplier at end of life. */
  grow?: number;
  colors: THREE.ColorRepresentation[];
  /** Fade colour at end of life; defaults to the start colour. */
  endColor?: THREE.ColorRepresentation;
  gravity?: number;
  drag?: number;
  alpha?: number;
}

const VERTEX = /* glsl */ `
  attribute float size;
  attribute vec4 rgba;
  varying vec4 vColor;
  uniform float pixelRatio;
  void main() {
    vColor = rgba;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vColor.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

/** A fixed-capacity pool of soft round particles drawn as GL points. */
class ParticlePool {
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rgba: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly grow: Float32Array;
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  private readonly alpha: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;

  constructor(capacity: number, blending: THREE.Blending) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.rgba = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity).fill(1);
    this.baseSize = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.c0 = new Float32Array(capacity * 3);
    this.c1 = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('rgba', new THREE.BufferAttribute(this.rgba, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { pixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(o: EmitOptions) {
    const tmp = new THREE.Vector3();
    const colors = o.colors.map((c) => new THREE.Color(c));
    const end = o.endColor !== undefined ? new THREE.Color(o.endColor) : null;
    const rand = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
    for (let k = 0; k < o.count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;

      if (o.dir) {
        // Random direction within a cone around dir.
        const spread = o.spread ?? 0.4;
        tmp.copy(o.dir).normalize();
        const ortho = Math.abs(tmp.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const u = new THREE.Vector3().crossVectors(tmp, ortho).normalize();
        const v = new THREE.Vector3().crossVectors(tmp, u);
        const a = Math.random() * Math.PI * 2;
        const s = Math.tan(spread) * Math.sqrt(Math.random());
        tmp.addScaledVector(u, Math.cos(a) * s).addScaledVector(v, Math.sin(a) * s).normalize();
      } else {
        tmp.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      }
      const speed = rand(o.speed);
      const j = o.jitter ?? 0;
      this.pos[i * 3] = o.at.x + (Math.random() * 2 - 1) * j;
      this.pos[i * 3 + 1] = o.at.y + Math.random() * j * 0.5;
      this.pos[i * 3 + 2] = o.at.z + (Math.random() * 2 - 1) * j;
      this.vel[i * 3] = tmp.x * speed;
      this.vel[i * 3 + 1] = tmp.y * speed;
      this.vel[i * 3 + 2] = tmp.z * speed;
      this.life[i] = rand(o.life);
      this.age[i] = 0;
      this.baseSize[i] = rand(o.size);
      this.grow[i] = o.grow ?? 1;
      const c = colors[Math.floor(Math.random() * colors.length)];
      const e = end ?? c;
      this.c0.set([c.r, c.g, c.b], i * 3);
      this.c1.set([e.r, e.g, e.b], i * 3);
      this.alpha[i] = o.alpha ?? 1;
      this.gravity[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= 1) {
        this.rgba[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      this.age[i] = Math.min(1, this.age[i] + dt / this.life[i]);
      const t = this.age[i];
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damp - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= damp;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      for (let ch = 0; ch < 3; ch++) {
        this.rgba[i * 4 + ch] = this.c0[i * 3 + ch] + (this.c1[i * 3 + ch] - this.c0[i * 3 + ch]) * t;
      }
      // Quick fade in, long fade out.
      this.rgba[i * 4 + 3] = this.alpha[i] * Math.min(1, t * 12) * (1 - t) ** 1.5;
      this.size[i] = this.baseSize[i] * (1 + (this.grow[i] - 1) * t);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.rgba.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
  }
}

interface Shard {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  scale: number;
  age: number;
  life: number;
}

/** Physically tumbling fragments that bounce on the board. */
class ShardPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly shards: Shard[] = [];
  private readonly dummy = new THREE.Object3D();
  private cursor = 0;

  constructor(capacity: number) {
    const geo = new THREE.DodecahedronGeometry(0.07, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.shards.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        scale: 0,
        age: 1,
        life: 1,
      });
      this.mesh.setColorAt(i, new THREE.Color(0xffffff));
    }
    this.hideAll();
  }

  private hideAll() {
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.shards.length; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Bursts `count` fragments from `at`, biased along `dir` if given. */
  burst(at: THREE.Vector3, count: number, colors: THREE.ColorRepresentation[], dir?: THREE.Vector3, force = 3) {
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.shards.length;
      const s = this.shards[i];
      s.pos.set(at.x + (Math.random() - 0.5) * 0.5, at.y + 0.05 + Math.random() * 0.2, at.z + (Math.random() - 0.5) * 0.5);
      s.vel.set(Math.random() * 2 - 1, 0.6 + Math.random() * 1.2, Math.random() * 2 - 1).normalize().multiplyScalar(force * (0.5 + Math.random()));
      if (dir) s.vel.addScaledVector(dir, force * 0.8);
      s.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      s.spin.set(Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8);
      s.scale = 0.5 + Math.random() * 1.3;
      s.age = 0;
      s.life = 1.2 + Math.random() * 0.8;
      this.mesh.setColorAt(i, c.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    let any = false;
    this.shards.forEach((s, i) => {
      if (s.age >= 1) return;
      any = true;
      s.age = Math.min(1, s.age + dt / s.life);
      s.vel.y -= 9.8 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < 0.04) {
        // Bounce with friction on the board surface.
        s.pos.y = 0.04;
        s.vel.y *= -0.35;
        s.vel.x *= 0.6;
        s.vel.z *= 0.6;
        s.spin.multiplyScalar(0.6);
      }
      s.rot.x += s.spin.x * dt;
      s.rot.y += s.spin.y * dt;
      s.rot.z += s.spin.z * dt;
      this.dummy.position.copy(s.pos);
      this.dummy.rotation.copy(s.rot);
      const shrink = s.age > 0.7 ? 1 - (s.age - 0.7) / 0.3 : 1;
      this.dummy.scale.setScalar(s.scale * shrink);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    });
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function radialTexture(stops: [number, string][]) {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A bright crescent used for blade slashes. */
function slashTexture() {
  const W = 256;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = g;
  ctx.lineCap = 'round';
  for (const [w, a] of [
    [26, 0.25],
    [12, 0.6],
    [4, 1],
  ] as const) {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 1.25, W * 0.46, H * 1.0, 0, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Shared effect primitives: particles, shards, shockwaves, flashes and light. */
export class Effects {
  readonly additive = new ParticlePool(2500, THREE.AdditiveBlending);
  readonly soft = new ParticlePool(1500, THREE.NormalBlending);
  readonly shards = new ShardPool(260);
  private readonly ringTexture = radialTexture([
    [0, 'rgba(255,255,255,0)'],
    [0.72, 'rgba(255,255,255,0)'],
    [0.86, 'rgba(255,255,255,1)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  private readonly glowTexture = radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.3, 'rgba(255,255,255,0.6)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  private readonly slashTex = slashTexture();
  private readonly light = new THREE.PointLight(0xffa040, 0, 9, 1.6);
  level: FxLevel = 'full';

  constructor(private readonly stage: Stage) {
    stage.scene.add(this.additive.points, this.soft.points, this.shards.mesh, this.light);
    stage.addFrameListener((dt) => {
      this.additive.update(dt);
      this.soft.update(dt);
      this.shards.update(dt);
    });
  }

  /** Scales particle counts to the effect level. */
  n(count: number) {
    return this.level === 'full' ? count : Math.round(count * 0.4);
  }

  emit(o: EmitOptions, additive = true) {
    (additive ? this.additive : this.soft).emit({ ...o, count: this.n(o.count) });
  }

  shatter(at: THREE.Vector3, colors: THREE.ColorRepresentation[], dir?: THREE.Vector3, force = 3, count = 26) {
    this.shards.burst(at, this.n(count), colors, dir, force);
  }

  /** Expanding ring on the board surface. */
  shockwave(at: THREE.Vector3, color: THREE.ColorRepresentation, radius = 2.2, duration = 0.5) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        map: this.ringTexture,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, 0.05, at.z);
    this.stage.scene.add(mesh);
    const mat = mesh.material;
    return tween(
      duration,
      (t) => {
        mesh.scale.setScalar(0.2 + radius * t);
        mat.opacity = 1 - t;
      },
      (t) => 1 - Math.pow(1 - t, 2),
    ).then(() => this.dispose(mesh));
  }

  /** Billboarded glow sprite, for muzzle flashes and explosions. */
  glow(at: THREE.Vector3, color: THREE.ColorRepresentation, size = 2, duration = 0.35) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.position.copy(at);
    this.stage.scene.add(sprite);
    return tween(duration, (t) => {
      sprite.scale.setScalar(size * (0.4 + t * 0.8));
      sprite.material.opacity = 1 - t;
    }).then(() => this.disposeSprite(sprite));
  }

  /** A glowing ball the caller moves itself (cannon shot); call dispose() when done. */
  orb(color: THREE.ColorRepresentation, size = 1) {
    const make = (c: THREE.ColorRepresentation, scale: number) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTexture, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      sprite.scale.setScalar(size * scale);
      return sprite;
    };
    const group = new THREE.Group();
    group.add(make(color, 1), make(0xffffff, 0.45));
    this.stage.scene.add(group);
    return {
      position: group.position,
      dispose: () => {
        this.stage.scene.remove(group);
        group.children.forEach((c) => (c as THREE.Sprite).material.dispose());
      },
    };
  }

  /** A crescent blade trail sweeping across `at`, oriented by `angle` around Y. */
  slash(at: THREE.Vector3, angle: number, color: THREE.ColorRepresentation = 0xfff3d6, duration = 0.28) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 1.4),
      new THREE.MeshBasicMaterial({
        map: this.slashTex,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(at.x, 0.45, at.z);
    mesh.rotation.set(-Math.PI / 2 + 0.5, angle, 0, 'YXZ');
    this.stage.scene.add(mesh);
    const mat = mesh.material;
    return tween(duration, (t) => {
      mesh.scale.set(0.4 + t * 0.9, 1, 1);
      mat.opacity = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
    }).then(() => this.dispose(mesh));
  }

  /** Vertical beam of light, for the advisor and elephant seals. */
  pillar(at: THREE.Vector3, color: THREE.ColorRepresentation, duration = 0.9) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.5, 4, 32, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        map: this.glowTexture,
      }),
    );
    mesh.position.set(at.x, 2, at.z);
    this.stage.scene.add(mesh);
    const mat = mesh.material;
    return tween(duration, (t) => {
      mesh.scale.set(1 - t * 0.6, 0.2 + Math.min(1, t * 3), 1 - t * 0.6);
      mesh.position.y = mesh.scale.y * 2;
      mat.opacity = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
    }).then(() => this.dispose(mesh));
  }

  /** Short burst of real light that also lights the pieces around the impact. */
  flashLight(at: THREE.Vector3, color: THREE.ColorRepresentation, intensity = 30, duration = 0.45) {
    this.light.color.set(color);
    this.light.position.set(at.x, at.y + 0.8, at.z);
    return tween(duration, (t) => (this.light.intensity = intensity * (1 - t) ** 2));
  }

  private dispose(mesh: THREE.Mesh) {
    this.stage.scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  private disposeSprite(sprite: THREE.Sprite) {
    this.stage.scene.remove(sprite);
    sprite.material.dispose();
  }
}
