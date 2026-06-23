import React from "react";

/**
 * Mock next/image for vitest — renders a plain <img> tag.
 * next/image's optimization features don't work in jsdom.
 */
function MockImage({ alt = "", ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  return <img {...props} alt={alt} />;
}

MockImage.displayName = "Image";

export default MockImage;
