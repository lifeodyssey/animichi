import React from "react";

export default function dynamic(
  _loader: () => Promise<unknown>,
  _opts?: { ssr?: boolean },
) {
  return function DynamicPlaceholder() {
    return React.createElement("div", {
      "data-testid": "map-placeholder",
      style: {
        width: "100%",
        height: "100%",
        minHeight: 300,
        background: "var(--color-muted)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        color: "var(--color-muted-fg)",
        fontSize: 13,
      },
    }, "Map (Storybook placeholder)");
  };
}
