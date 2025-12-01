import React from 'react';

/**
 * A small dispatcher that routes to a workpaper layout renderer based on layoutType.
 * Falls back to the provided default renderer if the type is missing or unrecognized.
 */
export default function WorkpaperRenderer({ layoutType, layoutConfig, renderers = {}, fallbackRenderer }) {
  const typeKey = typeof layoutType === 'string' && layoutType.trim() ? layoutType.trim() : '';
  const Renderer = typeKey && renderers[typeKey] ? renderers[typeKey] : fallbackRenderer;

  if (typeof Renderer === 'function') {
    return <Renderer layoutConfig={layoutConfig} />;
  }

  return null;
}
