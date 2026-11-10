import { stepParticle, type Point3 } from "@/shell/dock/orbModel";
import type { OrbCanvas } from "@/shell/dock/orbCanvas";
import { spatialPose } from "./spatialIdentity";
import { drawSurfaceLayer, prepareSurface } from "./particleSurface";

type Projected = { x: number; y: number; z: number; scale: number };
type Mark = { kind: "dot" | "line" | "sphere" | "face"; points: Projected[]; z: number; size: number; alpha: number; light: number; specular: number };

export function drawSpatialOrb(o: OrbCanvas, time: number, reduced: boolean) {
  const glyph = o.glyph;
  if (!glyph) return;
  o.x.clearRect(0, 0, o.P, o.P);
  if (glyph.showField && glyph.surface) {
    prepareSurface(o, glyph.surface, reduced ? 0 : time);
    drawSurfaceLayer(o, glyph.surface, false);
  }
  drawSpatialForm(o, time, reduced);
  if (glyph.showField && glyph.surface) drawSurfaceLayer(o, glyph.surface, true);
}

function drawSpatialForm(o: OrbCanvas, time: number, reduced: boolean) {
  const glyph = o.glyph!;
  const { x, P, R, q, color, coreColor: core } = o, center = P / 2, t = reduced ? 0 : time;
  const shape = glyph.spatial, rotate = spatialPose(shape, t), compact = R / q < 36;
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const shade = (light: number, white = 0) => `rgb(${rgb.map((v) => Math.round(Math.min(255, v * light + (255 - v) * white))).join(",")})`;
  const project = (p: Point3): Projected => { const scale = R / (1 - p[2] * .16); return { x: center + p[0] * scale, y: center + p[1] * scale, z: p[2], scale }; };
  const marks: Mark[] = [];
  const mouse = o.m, velocity = mouse && o.last ? { x: mouse.x - o.last.x, y: mouse.y - o.last.y } : { x: 0, y: 0 };
  o.last = mouse && { ...mouse };
  const cap = R * .15; velocity.x = Math.max(-cap, Math.min(cap, velocity.x)); velocity.y = Math.max(-cap, Math.min(cap, velocity.y));
  const addLine = (a: Projected, b: Projected, size: number, alpha: number, light: number) => marks.push({ kind: "line", points: [a, b], z: (a.z + b.z) / 2, size, alpha, light, specular: 0 });
  x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
  const shapeScale = glyph.showField ? 1 : 1.23;
  const shapePoint = (p: Point3) => { const r = rotate(p); return project(r.map((v) => v * shapeScale) as Point3); };
  shape.lines.forEach((line, index) => {
    let previous = shapePoint(line.points[0]!);
    for (let i = 1; i < line.points.length; i++) {
      const current = shapePoint(line.points[i]!), shimmer = Math.pow(.5 + .5 * Math.sin(i / line.points.length * Math.PI * 2 - t * .9 + index), 10);
      addLine(previous, current, line.width * R * shapeScale, .98, line.light * (.72 + shimmer * .38)); previous = current;
    }
  });
  shape.spheres.forEach((sphere) => {
    const point = shapePoint(sphere.center);
    marks.push({ kind: "sphere", points: [point], z: point.z, size: sphere.radius * point.scale * shapeScale, alpha: 1, light: sphere.light, specular: 0 });
  });
  shape.satellites.forEach((satellite) => {
    const points = shape.lines[satellite.line]!.points, position = ((t * satellite.speed + satellite.phase) % 1) * (points.length - 1), i = Math.floor(position), fraction = position - i;
    const a = points[i]!, b = points[(i + 1) % points.length]!, p = a.map((v, axis) => v + (b[axis]! - v) * fraction) as Point3;
    const point = shapePoint(p);
    marks.push({ kind: "sphere", points: [point], z: point.z, size: satellite.radius * point.scale * shapeScale, alpha: 1, light: 1.3, specular: .6 });
  });
  shape.faces.forEach((face) => {
    const points = face.vertices.map(shapePoint), normal = rotate(face.normal), flip = normal[2] < 0 ? -1 : 1;
    const diffuse = Math.max(0, flip * (-normal[0] * .45 - normal[1] * .55 + normal[2] * .7));
    const specular = Math.pow(Math.max(0, flip * (-normal[0] * .24 - normal[1] * .32 + normal[2] * .92)), 18);
    marks.push({ kind: "face", points, z: points.reduce((z, p) => z + p.z, 0) / points.length, size: 0, alpha: 1, light: (.22 + diffuse * .68) * face.light, specular });
  });
  for (let i = 0; i < shape.group.pts.length; i += compact ? 2 : 1) {
    const point = shapePoint(shape.group.pts[i]!);
    const near = stepParticle(glyph.state, shape.group, i, point, mouse, velocity, R), shine = Math.pow(.5 + .5 * Math.sin(t * .8 + shape.group.ph[i]!), 12);
    if (shine < .35 && near < .1) continue;
    marks.push({ kind: "dot", points: [point], z: point.z + .015, size: q * (.65 + shine * .45), alpha: shine * .4 + near * .4, light: 1, specular: .5 });
  }
  marks.sort((a, b) => a.z - b.z);
  x.lineCap = "round"; x.lineJoin = "round";
  for (const mark of marks) {
    const point = mark.points[0]!, front = .7 + .3 * (mark.z + 1) / 2;
    x.globalAlpha = mark.alpha; x.globalCompositeOperation = "source-over";
    if (mark.kind === "dot") {
      x.fillStyle = mark.specular ? core : shade(mark.light); x.fillRect(point.x - mark.size / 2, point.y - mark.size / 2, mark.size, mark.size);
    } else if (mark.kind === "line") {
      const end = mark.points[1]!;
      const stroke = (width: number, style: string, offset = 0) => { x.lineWidth = width; x.strokeStyle = style; x.beginPath(); x.moveTo(point.x + offset, point.y + offset); x.lineTo(end.x + offset, end.y + offset); x.stroke(); };
      stroke(Math.max(q * .7, mark.size + q * .35), shade(.18));
      stroke(Math.max(q * .45, mark.size * .75), shade(mark.light * front, .1));
      stroke(Math.max(q * .23, mark.size * .2), shade(.8, .5), -Math.min(q * .4, mark.size * .13));
    } else if (mark.kind === "sphere") {
      const r = mark.size, g = x.createRadialGradient(point.x - r * .3, point.y - r * .35, r * .03, point.x + r * .1, point.y + r * .1, r * 1.05);
      g.addColorStop(0, core); g.addColorStop(.25, shade(mark.light, .2)); g.addColorStop(.7, shade(.5)); g.addColorStop(1, shade(.13));
      x.fillStyle = g; x.beginPath(); x.arc(point.x, point.y, r, 0, Math.PI * 2); x.fill();
      if (mark.specular) { x.globalCompositeOperation = "lighter"; x.globalAlpha = .24; x.shadowColor = color; x.shadowBlur = q * 4; x.fillStyle = core; x.beginPath(); x.arc(point.x - r * .25, point.y - r * .3, r * .24, 0, Math.PI * 2); x.fill(); x.shadowBlur = 0; }
    } else {
      const faceGradient = x.createLinearGradient(point.x, point.y, center + R * .5, center + R * .5);
      faceGradient.addColorStop(0, shade(mark.light, mark.specular * .68 + .05)); faceGradient.addColorStop(1, shade(mark.light * .7, mark.specular * .2));
      x.fillStyle = faceGradient; x.strokeStyle = shade(mark.light, .12); x.lineWidth = q * .35;
      x.beginPath(); mark.points.forEach((p, i) => { if (i) x.lineTo(p.x, p.y); else x.moveTo(p.x, p.y); }); x.closePath(); x.fill(); x.stroke();
    }
  }
  x.globalCompositeOperation = "source-over"; x.globalAlpha = 1; x.shadowBlur = 0;
}
