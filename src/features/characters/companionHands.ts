import * as THREE from "three";

const finger = /(?:thumb|index|middle|ring|pinky)(?:_0[123]_[lr]|[1234])\.quaternion$/i;

const sampledQuaternion = (track: THREE.KeyframeTrack) => track.getValueSize() === 4 &&
  (track.getInterpolation() === THREE.InterpolateLinear || track.getInterpolation() === THREE.InterpolateDiscrete);

export function prepareCompanionAnimations(animations: THREE.AnimationClip[]) {
  const texting = animations.find((clip) => clip.name === "Texting While Standing");
  const quiet = animations.find((clip) => clip.name === "Sad Idle");
  if (!texting || !quiet) return animations;
  const quietTracks = new Map(quiet.tracks.map((track) => [track.name, track]));
  const prepared = texting.clone();
  prepared.tracks = prepared.tracks.map((track) => {
    if (!finger.test(track.name) || !sampledQuaternion(track)) return track;
    const reference = quietTracks.get(track.name);
    if (!reference || !sampledQuaternion(reference)) return track;
    const interpolate = reference.getInterpolation() === THREE.InterpolateDiscrete
      ? reference.InterpolantFactoryMethodDiscrete() : reference.InterpolantFactoryMethodLinear();
    const relaxed = new THREE.Quaternion().fromArray(interpolate.evaluate(quiet.duration / 2)).normalize();
    // A human phone grip folds these large stylized fingers into each other; keep their relaxed pose instead.
    if (!/thumb/i.test(track.name)) {
      return new THREE.QuaternionKeyframeTrack(track.name, [0, prepared.duration], [...relaxed.toArray(), ...relaxed.toArray()]);
    }
    const values = track.values.slice();
    const rotation = new THREE.Quaternion();
    const source = new THREE.Quaternion();
    for (let i = 0; i < values.length; i += 4) {
      rotation.copy(relaxed).slerp(source.fromArray(track.values, i), 0.15).normalize().toArray(values, i);
    }
    return new THREE.QuaternionKeyframeTrack(track.name, track.times.slice(), values, track.getInterpolation());
  });
  return animations.map((clip) => clip === texting ? prepared : clip);
}
