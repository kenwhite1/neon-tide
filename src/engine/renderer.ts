import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  float h = vDir.y;
  vec3 top = vec3(0.020, 0.030, 0.075);
  vec3 mid = vec3(0.028, 0.10, 0.16);
  vec3 bot = vec3(0.012, 0.018, 0.038);
  vec3 col = mix(bot, mid, smoothstep(-0.25, 0.02, h));
  col = mix(col, top, smoothstep(0.03, 0.55, h));
  // teal horizon glow line
  col += vec3(0.05, 0.35, 0.42) * pow(max(0.0, 1.0 - abs(h - 0.015) * 9.0), 3.0) * 0.55;
  // sparse stars
  vec3 cell = floor(vDir * 160.0);
  float s = hash(cell);
  if (s > 0.9975 && h > 0.08) {
    float tw = hash(cell + 1.0) * 0.5 + 0.5;
    col += vec3(0.7, 0.85, 1.0) * tw * 0.8;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  sun: THREE.DirectionalLight;
  private sunOffset = new THREE.Vector3(-13, 27, -11);

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'game-canvas';

    this.scene.fog = new THREE.FogExp2(0x05080f, 0.0072);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 700);
    this.camera.position.set(10, 8, -20);

    // image-based lighting for the PBR materials
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    if ('environmentIntensity' in this.scene) (this.scene as any).environmentIntensity = 0.45;

    const hemi = new THREE.HemisphereLight(0x8fc4e8, 0x0a0f1c, 0.5);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xeaf4ff, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 2; sc.far = 90;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(480, 24, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false }),
    );
    sky.frustumCulled = false;
    this.scene.add(sky);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    // repaint immediately so rotation/backgrounded resizes never flash black
    this.composer.render();
  }

  /** Keeps the shadow-casting sun centered on the action. */
  followLight(target: THREE.Vector3) {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
  }

  render() {
    this.composer.render();
  }
}
