"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { type MeshPart, parseThreeMfMesh } from "@/lib/threemf-mesh";

/**
 * A turntable preview of a generated part, in the colours it will print in.
 *
 * This reads the **3MF**, not an STL, and that is the whole point. A dog cup
 * is one object made of three parts, the cup, the paw and the name, and the
 * paw and the name print in a second filament. An STL is one undifferentiated
 * mesh, so a preview built on it can only ever be grey, which hides the thing
 * a customer is actually choosing.
 *
 * Each part becomes its own `THREE.Mesh` with its own material, so the split
 * survives all the way to the screen and the legend underneath can name which
 * filament slot each colour comes out of.
 *
 * Drag to orbit, wheel to zoom. Written against three directly rather than
 * pulling in react-three-fiber: this is a handful of meshes and two lights.
 */
export function MeshPreview({ url }: { url: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [parts, setParts] = useState<MeshPart[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetching and parsing is separate from rendering so the legend can be
  // driven by React while three keeps its own imperative scene.
  useEffect(() => {
    let cancelled = false;
    setParts(null);
    setError(null);

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (!cancelled) {
          setParts(parseThreeMfMesh(buffer));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load the preview.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !parts) {
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

    // Two lights and no shadows: the point is to read the geometry and tell
    // the colours apart, and a single hard light leaves half a round part
    // unlit and washes the colour out of the other half.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1, 1.4, 1);
    scene.add(key);

    // Parts are modelled in one shared coordinate system, so they are centred
    // and scaled together — centring each on its own box would scatter them.
    const group = new THREE.Group();
    const built: THREE.Mesh[] = [];
    const bounds = new THREE.Box3();

    for (const part of parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox!);

      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(part.color),
          roughness: 0.62,
          metalness: 0.02,
        }),
      );
      group.add(mesh);
      built.push(mesh);
    }

    const centre = bounds.getCenter(new THREE.Vector3());
    group.position.set(-centre.x, -centre.y, -centre.z);
    // Modelled Z-up (a print sits on the plate); three is Y-up. Rotating a
    // wrapper rather than the group keeps the centring above in model space.
    const pivot = new THREE.Group();
    pivot.rotation.x = -Math.PI / 2;
    pivot.add(group);
    scene.add(pivot);

    let frame = 0;
    let theta = Math.PI / 4;
    let phi = Math.PI / 3;
    // Fit the bounding sphere in the vertical field of view, plus a margin.
    const size = bounds.getSize(new THREE.Vector3());
    let radius = (size.length() / 2 / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
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
      // Plus, not minus. `placeCamera` puts x on cos(theta) and z on sin(theta),
      // which is the opposite handedness to the usual x=sin/z=cos spherical
      // form, so the sign that orbits a camera the natural way there drags it
      // backwards here. Dragging right has to move the camera to its own left
      // for the part to follow the pointer instead of running away from it.
      theta += (event.clientX - lastX) * 0.01;
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
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      for (const mesh of built) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      renderer.dispose();
      canvas.remove();
    };
  }, [parts]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-80 w-full overflow-hidden rounded-xl border border-[var(--card-border)]">
        <div ref={mountRef} className="size-full touch-none" />
        {(!parts || error) && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted">
            {error ?? "Loading preview…"}
          </div>
        )}
      </div>
      {parts && parts.length > 1 && (
        // Which colour is which part, and which filament slot it comes out of.
        // The slot is the number that matters at the printer: Bambu Studio
        // picks filament from it and ignores the colours in the file.
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {parts.map((part, index) => (
            <span key={`${part.name}-${index}`} className="inline-flex items-center gap-1.5">
              <span
                className="size-3 rounded-full border border-[var(--card-border)]"
                style={{ backgroundColor: part.color }}
              />
              {part.name}
              {part.extruder !== null && <span>· slot {part.extruder}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
