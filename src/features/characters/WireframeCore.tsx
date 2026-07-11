import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SNOISE_GLSL } from "@/shell/Splash/snoise";

// A character stands inside this: two noise-displaced wireframe icosahedron
// shells (same look as the startup EnergyCore), tinted per character. Kept
// lightweight (no particles/post) so 8 of these run fine across the gallery.

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uChaos;
  uniform float uFreq;
  varying float vDisp;
  ${SNOISE_GLSL}
  void main(){
    vec3 dir = normalize(position);
    float n  = snoise(dir * uFreq + uTime * 0.4);
    float n2 = snoise(dir * (uFreq * 2.1) - uTime * 0.65);
    float disp = (n * 0.7 + n2 * 0.3);
    vDisp = disp;
    vec3 displaced = position + normal * disp * uChaos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;
const FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform float uOpacity;
  varying float vDisp;
  void main(){
    float t = clamp(vDisp * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uLow, uHigh, smoothstep(0.1, 0.9, t));
    gl_FragColor = vec4(col, uOpacity);
  }
`;

function shellMaterial(color: THREE.Color, opacity: number, freq: number) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uChaos: { value: 0.1 },
      uFreq: { value: freq },
      uLow: { value: color.clone().multiplyScalar(0.45) },
      uHigh: { value: color.clone() },
      uOpacity: { value: opacity },
    },
    wireframe: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function WireframeCore({ color }: { color: string }) {
  const inner = useRef<THREE.Group>(null);
  const outer = useRef<THREE.Group>(null);

  const c = useMemo(() => new THREE.Color(color), [color]);
  const innerMat = useMemo(() => shellMaterial(c, 0.5, 1.7), [c]);
  const outerMat = useMemo(() => shellMaterial(c, 0.28, 1.1), [c]);
  const innerGeo = useMemo(() => new THREE.IcosahedronGeometry(1.05, 5), []);
  const outerGeo = useMemo(() => new THREE.IcosahedronGeometry(1.35, 2), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    innerMat.uniforms.uTime!.value = t;
    outerMat.uniforms.uTime!.value = t;
    if (inner.current) {
      inner.current.rotation.y = t * 0.18;
      inner.current.rotation.x = t * 0.07;
    }
    if (outer.current) {
      outer.current.rotation.y = -t * 0.12;
      outer.current.rotation.z = t * 0.05;
    }
  });

  return (
    <group>
      <group ref={inner}>
        <mesh geometry={innerGeo} material={innerMat} />
      </group>
      <group ref={outer}>
        <mesh geometry={outerGeo} material={outerMat} />
      </group>
      <pointLight position={[0, 0, 3]} color={c} intensity={2.2} distance={9} />
    </group>
  );
}
