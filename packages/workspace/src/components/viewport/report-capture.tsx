"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { setViewportCapture } from "../../lib/viewport-capture";

/**
 * Lets a bug report capture this canvas. It draws a frame and reads it in
 * the same task, so the canvas doesn't keep its drawing buffer every frame.
 */
export function ReportCapture() {
  const get = useThree((state) => state.get);
  useEffect(
    () =>
      setViewportCapture(() => {
        const { gl, scene, camera } = get();
        gl.render(scene, camera);
        const screenshot = new Promise<Blob | null>((resolve) => gl.domElement.toBlob(resolve));
        const context = gl.getContext();
        const info = context.getExtension("WEBGL_debug_renderer_info");
        const renderer = String(
          context.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : context.RENDERER),
        );
        return { screenshot, renderer };
      }),
    [get],
  );
  return null;
}
