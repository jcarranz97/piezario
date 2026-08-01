"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

/**
 * A turntable preview of a generated mesh.
 *
 * STL rather than the 3MF, even though the 3MF is the file to print: STL is
 * one mesh in one format with a loader in three.js's own examples, while a
 * Bambu 3MF is a zip whose per-part colours and extruder assignments live in a
 * sidecar config. Reading that properly is worth doing — it is where the
 * multi-colour split lives — but it is a second step, and the shape is the
 * thing to check before ordering.
 *
 * Drag to orbit, wheel to zoom. Written against three directly rather than
 * pulling in react-three-fiber: this is one mesh and one light, and the whole
 * viewer is shorter than the dependency's own setup would be.
 */
export function MeshPreview({ url }: { url: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      5000,
    );
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    // Two lights and no shadows: the point is to read the geometry, and a
    // single hard light leaves half of a round part unlit.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.4, 1);
    scene.add(key);

    const group = new THREE.Group();
    scene.add(group);

    let frame = 0;
    let disposed = false;
    let mesh: THREE.Mesh | null = null;

    // Orbit state, kept here rather than through OrbitControls — two angles
    // and a radius is the whole interaction.
    let theta = Math.PI / 4;
    let phi = Math.PI / 3;
    let radius = 100;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    function placeCamera() {
      camera.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
      camera.lookAt(0, 0, 0);
    }

    const loader = new STLLoader();
    loader.load(
      url,
      (geometry) => {
        if (disposed) {
          geometry.dispose();
          return;
        }
        geometry.computeVertexNormals();
        // Centre on the part's own bounding box, so the turntable spins about
        // the model rather than about wherever the plate origin happened to be.
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const centre = box.getCenter(new THREE.Vector3());
        geometry.translate(-centre.x, -centre.y, -centre.z);

        mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: 0xb9c2d0,
            roughness: 0.55,
            metalness: 0.05,
            flatShading: false,
          }),
        );
        // These are modelled Z-up (a print sits on the plate); three is Y-up.
        mesh.rotation.x = -Math.PI / 2;
        group.add(mesh);

        // Fit the part's bounding sphere in the vertical field of view, plus
        // a small margin. A flat multiplier of the largest dimension has to
        // guess, and it guesses badly on a long thin part like a handle.
        const size = box.getSize(new THREE.Vector3());
        const sphere = size.length() / 2;
        radius = (sphere / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
        placeCamera();
        setLoading(false);
      },
      undefined,
      () => {
        if (!disposed) {
          setError("Could not load the preview mesh.");
          setLoading(false);
        }
      },
    );

    const canvas = renderer.domElement;
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }
      theta -= (event.clientX - lastX) * 0.01;
      // Clamped short of the poles: at exactly vertical the look-at basis is
      // degenerate and the view snaps round.
      phi = Math.min(Math.PI - 0.05, Math.max(0.05, phi - (event.clientY - lastY) * 0.01));
      lastX = event.clientX;
      lastY = event.clientY;
      placeCamera();
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      radius = Math.min(2000, Math.max(10, radius * (event.deltaY > 0 ? 1.1 : 0.9)));
      placeCamera();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const resize = new ResizeObserver(() => {
      if (mount.clientWidth === 0) {
        return;
      }
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    });
    resize.observe(mount);

    placeCamera();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      // A slow idle spin while nobody is touching it: the whole reason to show
      // a 3D view rather than a render is that it turns.
      if (!dragging) {
        theta += 0.0025;
        placeCamera();
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      mesh?.geometry.dispose();
      (mesh?.material as THREE.Material | undefined)?.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [url]);

  return (
    <div className="relative h-80 w-full overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-bg,transparent)]">
      <div ref={mountRef} className="size-full touch-none" />
      {(loading || error) && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted">
          {error ?? "Loading preview…"}
        </div>
      )}
    </div>
  );
}
